import { Router } from 'express'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { getPool } from '../../db.js'
import { encrypt, decrypt } from '../../services/encryption.js'
import { sendInviteEmail } from '../../services/email.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { evictT212Client } from '../../api/trading212.js'
import type { UserConfig, MarketConfig, UniverseEntry } from '../../types/user.js'
import { EXCHANGE_CODES, type ExchangeCode } from '../../engine/markets.js'

const router = Router()

// All routes require authentication
router.use(requireAuth)

// ── Helper: get user api keys ──────────────────────────────────────────────

export async function getUserApiKeys(userId: string): Promise<{
  anthropicApiKey: string | null
  t212KeyId: string | null
  t212KeySecret: string | null
  t212Mode: 'demo' | 'live'
} | null> {
  const pool = getPool()
  const result = await pool.query<{
    anthropic_api_key_enc: string | null
    t212_api_key_id_enc: string | null
    t212_api_key_secret_enc: string | null
    t212_mode: string
  }>(
    'SELECT anthropic_api_key_enc, t212_api_key_id_enc, t212_api_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1',
    [userId]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    anthropicApiKey: row.anthropic_api_key_enc ? decrypt(row.anthropic_api_key_enc) : null,
    t212KeyId: row.t212_api_key_id_enc ? decrypt(row.t212_api_key_id_enc) : null,
    t212KeySecret: row.t212_api_key_secret_enc ? decrypt(row.t212_api_key_secret_enc) : null,
    t212Mode: row.t212_mode as 'demo' | 'live',
  }
}

export async function getUserConfig(userId: string): Promise<UserConfig | null> {
  const pool = getPool()
  const [cfgRes, marketsRes, tickersRes] = await Promise.all([
    pool.query<{ auto_start_on_restart: boolean }>(
      'SELECT auto_start_on_restart FROM user_configs WHERE user_id = $1',
      [userId]
    ),
    pool.query<{
      exchange_code: string
      active_from_local: string
      active_to_local: string
      enabled: boolean
      trade_interval_ms: number
      max_budget_eur: number
      max_position_pct: number
      daily_loss_limit_pct: number
      stop_loss_pct: number
      take_profit_pct: number
      stagnant_exit_enabled: boolean
      stagnant_time_minutes: number
      stagnant_range_pct: number
    }>(
      `SELECT exchange_code, active_from_local, active_to_local, enabled,
              trade_interval_ms, max_budget_eur, max_position_pct,
              daily_loss_limit_pct, stop_loss_pct, take_profit_pct,
              stagnant_exit_enabled, stagnant_time_minutes, stagnant_range_pct
         FROM user_markets
        WHERE user_id = $1
        ORDER BY exchange_code`,
      [userId]
    ),
    pool.query<{ ticker: string; exchange_code: string }>(
      'SELECT ticker, exchange_code FROM user_tickers WHERE user_id = $1 ORDER BY ticker',
      [userId]
    ),
  ])
  const cfgRow = cfgRes.rows[0]
  if (!cfgRow) return null

  const markets: MarketConfig[] = marketsRes.rows
    .filter((m) => EXCHANGE_CODES.includes(m.exchange_code as ExchangeCode))
    .map((m) => ({
      exchange: m.exchange_code as ExchangeCode,
      enabled: m.enabled,
      activeFrom: m.active_from_local,
      activeTo: m.active_to_local,
      tradeIntervalMs: Number(m.trade_interval_ms),
      maxBudgetEur: Number(m.max_budget_eur),
      maxPositionPct: Number(m.max_position_pct),
      dailyLossLimitPct: Number(m.daily_loss_limit_pct),
      stopLossPct: Number(m.stop_loss_pct),
      takeProfitPct: Number(m.take_profit_pct),
      stagnantExitEnabled: Boolean(m.stagnant_exit_enabled),
      stagnantTimeMinutes: Number(m.stagnant_time_minutes),
      stagnantRangePct: Number(m.stagnant_range_pct),
    }))

  const tradeUniverse: UniverseEntry[] = tickersRes.rows
    .filter((t) => EXCHANGE_CODES.includes(t.exchange_code as ExchangeCode))
    .map((t) => ({ ticker: t.ticker, exchange: t.exchange_code as ExchangeCode }))

  return {
    markets,
    tradeUniverse,
    autoStartOnRestart: Boolean(cfgRow.auto_start_on_restart),
  }
}

// ── Apply config update (body → user_configs + user_markets + user_tickers) ─

const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

interface MarketInput {
  exchange: ExchangeCode
  enabled: boolean
  activeFrom?: string
  activeTo?: string
  tradeIntervalMs?: number
  maxBudgetEur?: number
  maxPositionPct?: number
  dailyLossLimitPct?: number
  stopLossPct?: number
  takeProfitPct?: number
  stagnantExitEnabled?: boolean
  stagnantTimeMinutes?: number
  stagnantRangePct?: number
}

function parseMarketInput(raw: unknown): MarketInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  const exchange = m.exchange
  if (typeof exchange !== 'string' || !EXCHANGE_CODES.includes(exchange as ExchangeCode))
    return null
  if (typeof m.enabled !== 'boolean') return null

  const out: MarketInput = { exchange: exchange as ExchangeCode, enabled: m.enabled }

  const maybeHhmm = (v: unknown): string | null =>
    typeof v === 'string' && HHMM_RE.test(v) ? v : null
  const from = maybeHhmm(m.activeFrom)
  const to = maybeHhmm(m.activeTo)
  if (from) out.activeFrom = from
  if (to) out.activeTo = to
  if (out.activeFrom && out.activeTo && out.activeFrom >= out.activeTo) return null

  const maybeNum = (v: unknown, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null

  const tradeIntervalMs = maybeNum(m.tradeIntervalMs, 10_000, 24 * 60 * 60_000)
  if (tradeIntervalMs !== null) out.tradeIntervalMs = tradeIntervalMs

  const maxBudget = maybeNum(m.maxBudgetEur, 0.01, 1_000_000)
  if (maxBudget !== null) out.maxBudgetEur = maxBudget

  const maxPosPct = maybeNum(m.maxPositionPct, 0.001, 1)
  if (maxPosPct !== null) out.maxPositionPct = maxPosPct

  const dailyLoss = maybeNum(m.dailyLossLimitPct, 0.001, 1)
  if (dailyLoss !== null) out.dailyLossLimitPct = dailyLoss

  const stopLoss = maybeNum(m.stopLossPct, 0.001, 1)
  if (stopLoss !== null) out.stopLossPct = stopLoss

  const takeProfit = maybeNum(m.takeProfitPct, 0.001, 1)
  if (takeProfit !== null) out.takeProfitPct = takeProfit

  if (typeof m.stagnantExitEnabled === 'boolean') out.stagnantExitEnabled = m.stagnantExitEnabled
  const stagnantMin = maybeNum(m.stagnantTimeMinutes, 15, 60 * 24)
  if (stagnantMin !== null) out.stagnantTimeMinutes = stagnantMin
  const stagnantRange = maybeNum(m.stagnantRangePct, 0.0001, 0.5)
  if (stagnantRange !== null) out.stagnantRangePct = stagnantRange

  return out
}

function isValidUniverseEntry(e: unknown): e is UniverseEntry {
  if (typeof e !== 'object' || e === null) return false
  const { ticker, exchange } = e as Partial<UniverseEntry>
  return (
    typeof ticker === 'string' &&
    ticker.length > 0 &&
    typeof exchange === 'string' &&
    EXCHANGE_CODES.includes(exchange as ExchangeCode)
  )
}

/**
 * Persist a partial config update covering:
 *   - global: autoStartOnRestart
 *   - per-market: any subset of MarketConfig fields, indexed by exchange
 *   - tradeUniverse: full replace
 *
 * Markets can be patched one-at-a-time (UI saves a card at a time) — no need
 * to send the full markets array to tweak one field.
 */
export async function applyConfigUpdate(
  userId: string,
  body: Record<string, unknown>
): Promise<void> {
  const pool = getPool()

  if (typeof body.autoStartOnRestart === 'boolean') {
    await pool.query(
      `UPDATE user_configs SET auto_start_on_restart = $2, updated_at = NOW() WHERE user_id = $1`,
      [userId, body.autoStartOnRestart]
    )
  }

  // Markets. Each entry is a partial patch of that market's config. Upsert on
  // (user_id, exchange_code); fields left off the body keep their stored value.
  if (Array.isArray(body.markets)) {
    const raw = body.markets as unknown[]
    const parsed = raw.map(parseMarketInput)
    if (parsed.some((p) => p === null)) throw new Error('Invalid markets payload')
    for (const m of parsed as MarketInput[]) {
      const colMap: Record<string, unknown> = {
        enabled: m.enabled,
        active_from_local: m.activeFrom,
        active_to_local: m.activeTo,
        trade_interval_ms: m.tradeIntervalMs,
        max_budget_eur: m.maxBudgetEur,
        max_position_pct: m.maxPositionPct,
        daily_loss_limit_pct: m.dailyLossLimitPct,
        stop_loss_pct: m.stopLossPct,
        take_profit_pct: m.takeProfitPct,
        stagnant_exit_enabled: m.stagnantExitEnabled,
        stagnant_time_minutes: m.stagnantTimeMinutes,
        stagnant_range_pct: m.stagnantRangePct,
      }
      const cols = Object.entries(colMap).filter(([, v]) => v !== undefined) as [string, unknown][]
      if (cols.length === 0) continue

      // Upsert: if the market exists, patch only the supplied fields; otherwise
      // insert with the supplied fields + defaults for anything missing.
      const existingRes = await pool.query<{ id: number }>(
        `SELECT id FROM user_markets WHERE user_id = $1 AND exchange_code = $2`,
        [userId, m.exchange]
      )
      if (existingRes.rows[0]) {
        const setClauses = cols.map(([c], i) => `${c} = $${i + 3}`).join(', ')
        await pool.query(
          `UPDATE user_markets SET ${setClauses}, updated_at = NOW()
             WHERE user_id = $1 AND exchange_code = $2`,
          [userId, m.exchange, ...cols.map(([, v]) => v)]
        )
      } else {
        // New market — caller must have supplied enough fields, but we also
        // backfill any missing ones from sensible defaults so the row is valid.
        const defaults: Record<string, unknown> = {
          active_from_local: '09:00',
          active_to_local: '17:00',
          trade_interval_ms: 900_000,
          max_budget_eur: 100,
          max_position_pct: 0.25,
          daily_loss_limit_pct: 0.1,
          stop_loss_pct: 0.05,
          take_profit_pct: 0.015,
          stagnant_exit_enabled: true,
          stagnant_time_minutes: 120,
          stagnant_range_pct: 0.012,
        }
        const merged: Record<string, unknown> = {
          ...defaults,
          ...Object.fromEntries(cols),
          enabled: m.enabled,
        }
        const keys = Object.keys(merged)
        const placeholders = keys.map((_, i) => `$${i + 3}`).join(', ')
        await pool.query(
          `INSERT INTO user_markets (user_id, exchange_code, ${keys.join(', ')})
           VALUES ($1, $2, ${placeholders})`,
          [userId, m.exchange, ...keys.map((k) => merged[k])]
        )
      }
    }
  }

  // Trade universe — full replace. Each entry's exchange must be in an
  // *enabled* user_markets row.
  if (Array.isArray(body.tradeUniverse)) {
    const valid = (body.tradeUniverse as unknown[]).filter(isValidUniverseEntry)
    if (valid.length !== (body.tradeUniverse as unknown[]).length) {
      throw new Error('Invalid tradeUniverse payload')
    }
    const enabledRes = await pool.query<{ exchange_code: string }>(
      'SELECT exchange_code FROM user_markets WHERE user_id = $1 AND enabled = TRUE',
      [userId]
    )
    const enabledSet = new Set(enabledRes.rows.map((r) => r.exchange_code))
    const bad = valid.find((e) => !enabledSet.has(e.exchange))
    if (bad) {
      throw new Error(`Ticker ${bad.ticker} is on ${bad.exchange} but that market is not enabled`)
    }
    await pool.query('DELETE FROM user_tickers WHERE user_id = $1', [userId])
    for (const e of valid) {
      await pool.query(
        `INSERT INTO user_tickers (user_id, ticker, exchange_code) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, ticker) DO UPDATE SET exchange_code = EXCLUDED.exchange_code`,
        [userId, e.ticker, e.exchange]
      )
    }
  }
}

// ── GET /api/users/me — own full profile ───────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT u.user_id, u.email, u.username, u.first_name, u.last_name, u.dob,
              u.address1, u.address2, u.city, u.county, u.country, u.zipcode,
              u.phone, u.user_role, u.is_active, u.created_at,
              k.t212_mode,
              CASE WHEN k.anthropic_api_key_enc IS NOT NULL THEN true ELSE false END AS has_anthropic_key,
              CASE WHEN k.t212_api_key_id_enc IS NOT NULL THEN true ELSE false END AS has_t212_key
       FROM users u
       LEFT JOIN user_api_keys k ON k.user_id = u.user_id
       WHERE u.user_id = $1`,
      [req.user!.userId]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/me — update own profile ─────────────────────────────────
router.put('/me', async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      username,
      dob,
      address1,
      address2,
      city,
      county,
      country,
      zipcode,
      phone,
    } = req.body as Record<string, string>

    const pool = getPool()

    if (username) {
      const check = await pool.query(
        'SELECT user_id FROM users WHERE username = $1 AND user_id != $2',
        [username.trim(), req.user!.userId]
      )
      if (check.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' })
      }
    }

    await pool.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         username   = COALESCE($3, username),
         dob        = COALESCE($4::date, dob),
         address1   = COALESCE($5, address1),
         address2   = COALESCE($6, address2),
         city       = COALESCE($7, city),
         county     = COALESCE($8, county),
         country    = COALESCE($9, country),
         zipcode    = COALESCE($10, zipcode),
         phone      = COALESCE($11, phone),
         updated_at = NOW()
       WHERE user_id = $12`,
      [
        firstName?.trim() || null,
        lastName?.trim() || null,
        username?.trim() || null,
        dob || null,
        address1 || null,
        address2 || null,
        city || null,
        county || null,
        country || null,
        zipcode || null,
        phone || null,
        req.user!.userId,
      ]
    )

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/me/password ─────────────────────────────────────────────
router.put('/me/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string
      newPassword: string
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both currentPassword and newPassword are required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' })
    }

    const pool = getPool()
    const result = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [req.user!.userId]
    )
    const user = result.rows[0]
    if (!user) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' })

    const hash = await bcrypt.hash(newPassword, 12)
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2', [
      hash,
      req.user!.userId,
    ])
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/users/me/api-keys — masked keys ───────────────────────────────
router.get('/me/api-keys', async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query<{
      anthropic_api_key_enc: string | null
      t212_api_key_id_enc: string | null
      t212_api_key_secret_enc: string | null
      t212_mode: string
    }>(
      'SELECT anthropic_api_key_enc, t212_api_key_id_enc, t212_api_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1',
      [req.user!.userId]
    )
    const row = result.rows[0]
    if (!row) return res.json({ hasAnthropicKey: false, hasT212Key: false, t212Mode: 'demo' })

    res.json({
      hasAnthropicKey: !!row.anthropic_api_key_enc,
      hasT212Key: !!(row.t212_api_key_id_enc && row.t212_api_key_secret_enc),
      t212Mode: row.t212_mode,
    })
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/me/api-keys — update encrypted keys ────────────────────
router.put('/me/api-keys', async (req, res, next) => {
  try {
    const { anthropicApiKey, t212KeyId, t212KeySecret, t212Mode } = req.body as {
      anthropicApiKey?: string
      t212KeyId?: string
      t212KeySecret?: string
      t212Mode?: 'demo' | 'live'
    }

    const pool = getPool()
    const current = await pool.query<{
      anthropic_api_key_enc: string | null
      t212_api_key_id_enc: string | null
      t212_api_key_secret_enc: string | null
      t212_mode: string
    }>(
      'SELECT anthropic_api_key_enc, t212_api_key_id_enc, t212_api_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1',
      [req.user!.userId]
    )

    const existing = current.rows[0]

    await pool.query(
      `INSERT INTO user_api_keys (user_id, anthropic_api_key_enc, t212_api_key_id_enc, t212_api_key_secret_enc, t212_mode, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         anthropic_api_key_enc   = COALESCE($2, user_api_keys.anthropic_api_key_enc),
         t212_api_key_id_enc     = COALESCE($3, user_api_keys.t212_api_key_id_enc),
         t212_api_key_secret_enc = COALESCE($4, user_api_keys.t212_api_key_secret_enc),
         t212_mode               = COALESCE($5, user_api_keys.t212_mode),
         updated_at              = NOW()`,
      [
        req.user!.userId,
        anthropicApiKey ? encrypt(anthropicApiKey) : (existing?.anthropic_api_key_enc ?? null),
        t212KeyId ? encrypt(t212KeyId) : (existing?.t212_api_key_id_enc ?? null),
        t212KeySecret ? encrypt(t212KeySecret) : (existing?.t212_api_key_secret_enc ?? null),
        t212Mode ?? existing?.t212_mode ?? 'demo',
      ]
    )

    // Evict cached T212 client so next request picks up the new credentials
    evictT212Client(req.user!.userId)

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/users/me/config — user trading config ─────────────────────────
router.get('/me/config', async (req, res, next) => {
  try {
    const cfg = await getUserConfig(req.user!.userId)
    if (!cfg) return res.status(404).json({ error: 'Config not found — reseed the account' })
    res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/me/config — update user trading config ─────────────────
router.put('/me/config', async (req, res, next) => {
  try {
    await applyConfigUpdate(req.user!.userId, req.body as Record<string, unknown>)
    const cfg = await getUserConfig(req.user!.userId)
    res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Admin-only routes
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/users — list all users (admin) ────────────────────────────────
router.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT u.user_id, u.email, u.username, u.first_name, u.last_name,
              u.user_role, u.is_active, u.created_at,
              CASE WHEN k.anthropic_api_key_enc IS NOT NULL THEN true ELSE false END AS has_anthropic_key,
              CASE WHEN k.t212_api_key_id_enc IS NOT NULL THEN true ELSE false END AS has_t212_key
       FROM users u
       LEFT JOIN user_api_keys k ON k.user_id = u.user_id
       ORDER BY u.created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/users/invite — invite a new user (admin) ────────────────────
router.post('/invite', requireAdmin, async (req, res, next) => {
  try {
    const { email } = req.body as { email: string }
    if (!email) return res.status(400).json({ error: 'Email is required' })

    const normalizedEmail = email.toLowerCase().trim()
    const pool = getPool()

    // Check if user already exists
    const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [
      normalizedEmail,
    ])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' })
    }

    // Check for active pending invite
    const pendingInvite = await pool.query(
      `SELECT id FROM user_invitations WHERE email = $1 AND is_used = false AND expires_at > NOW()`,
      [normalizedEmail]
    )
    if (pendingInvite.rows.length > 0) {
      return res.status(409).json({ error: 'An active invitation already exists for this email' })
    }

    const token = randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO user_invitations (email, token, invited_by) VALUES ($1, $2, $3)`,
      [normalizedEmail, token, req.user!.userId]
    )

    await sendInviteEmail(normalizedEmail, token)
    res.status(201).json({ ok: true, email: normalizedEmail })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/users/invitations — list all invitations (admin) ─────────────
router.get('/invitations', requireAdmin, async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT i.id, i.email, i.is_used, i.created_at, i.expires_at, i.used_at,
              u.username AS invited_by_username
       FROM user_invitations i
       LEFT JOIN users u ON u.user_id = i.invited_by
       ORDER BY i.created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/users/invitations/:id — delete expired invitation (admin) ───
router.delete('/invitations/:id', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `DELETE FROM user_invitations
       WHERE id = $1 AND (is_used = true OR expires_at < NOW())
       RETURNING id`,
      [req.params.id]
    )
    if (result.rowCount === 0)
      return res.status(400).json({ error: 'Invitation not found or not expired/used' })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/users/:userId — get user (admin) ──────────────────────────────
router.get('/:userId', requireAdmin, async (req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT u.user_id, u.email, u.username, u.first_name, u.last_name, u.dob,
              u.address1, u.address2, u.city, u.county, u.country, u.zipcode,
              u.phone, u.user_role, u.is_active, u.created_at,
              k.t212_mode,
              CASE WHEN k.anthropic_api_key_enc IS NOT NULL THEN true ELSE false END AS has_anthropic_key,
              CASE WHEN k.t212_api_key_id_enc IS NOT NULL THEN true ELSE false END AS has_t212_key
       FROM users u
       LEFT JOIN user_api_keys k ON k.user_id = u.user_id
       WHERE u.user_id = $1`,
      [req.params.userId]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/:userId/role — change user role (admin) ─────────────────
router.put('/:userId/role', requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body as { role: string }
    if (!['admin', 'client', 'accountant'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin, client, or accountant' })
    }
    const pool = getPool()
    await pool.query('UPDATE users SET user_role = $1, updated_at = NOW() WHERE user_id = $2', [
      role,
      req.params.userId,
    ])
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/:userId/active — activate/deactivate (admin) ────────────
router.put('/:userId/active', requireAdmin, async (req, res, next) => {
  try {
    const { isActive } = req.body as { isActive: boolean }
    const pool = getPool()
    await pool.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE user_id = $2', [
      isActive,
      req.params.userId,
    ])
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
