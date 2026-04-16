import { Router } from 'express'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { getPool } from '../../db.js'
import { encrypt, decrypt } from '../../services/encryption.js'
import { sendInviteEmail } from '../../services/email.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { evictT212Client } from '../../api/trading212.js'

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

export async function getUserConfig(userId: string) {
  const pool = getPool()
  const result = await pool.query<{
    trade_universe: string
    trade_interval_ms: number
    max_budget_eur: number
    max_position_pct: number
    daily_loss_limit_pct: number
    stop_loss_pct: number
    take_profit_pct: number
    stagnant_exit_enabled: boolean
    stagnant_time_minutes: number
    stagnant_range_pct: number
    auto_start_on_restart: boolean
  }>('SELECT * FROM user_configs WHERE user_id = $1', [userId])
  const row = result.rows[0]
  if (!row) return null
  return {
    tradeUniverse: row.trade_universe
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    tradeIntervalMs: Number(row.trade_interval_ms),
    maxBudgetEur: Number(row.max_budget_eur),
    maxPositionPct: Number(row.max_position_pct),
    dailyLossLimitPct: Number(row.daily_loss_limit_pct),
    stopLossPct: Number(row.stop_loss_pct),
    takeProfitPct: Number(row.take_profit_pct),
    stagnantExitEnabled: Boolean(row.stagnant_exit_enabled),
    stagnantTimeMinutes: Number(row.stagnant_time_minutes),
    stagnantRangePct: Number(row.stagnant_range_pct),
    autoStartOnRestart: Boolean(row.auto_start_on_restart),
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
    res.json({ ...cfg, tradeIntervalS: cfg.tradeIntervalMs / 1000 })
  } catch (err) {
    next(err)
  }
})

// ── PUT /api/users/me/config — update user trading config ─────────────────
router.put('/me/config', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>
    const pool = getPool()

    const updates: Record<string, unknown> = {}
    if (Array.isArray(body.tradeUniverse)) {
      updates.trade_universe = (body.tradeUniverse as string[]).map(String).join(',')
    }
    if (typeof body.tradeIntervalMs === 'number' && body.tradeIntervalMs >= 10_000) {
      updates.trade_interval_ms = body.tradeIntervalMs
    }
    if (typeof body.maxBudgetEur === 'number' && body.maxBudgetEur > 0) {
      updates.max_budget_eur = body.maxBudgetEur
    }
    if (
      typeof body.maxPositionPct === 'number' &&
      body.maxPositionPct > 0 &&
      body.maxPositionPct <= 1
    ) {
      updates.max_position_pct = body.maxPositionPct
    }
    if (
      typeof body.dailyLossLimitPct === 'number' &&
      body.dailyLossLimitPct > 0 &&
      body.dailyLossLimitPct <= 1
    ) {
      updates.daily_loss_limit_pct = body.dailyLossLimitPct
    }
    if (typeof body.stopLossPct === 'number' && body.stopLossPct > 0 && body.stopLossPct <= 1) {
      updates.stop_loss_pct = body.stopLossPct
    }
    if (
      typeof body.takeProfitPct === 'number' &&
      body.takeProfitPct > 0 &&
      body.takeProfitPct <= 1
    ) {
      updates.take_profit_pct = body.takeProfitPct
    }
    if (typeof body.stagnantExitEnabled === 'boolean') {
      updates.stagnant_exit_enabled = body.stagnantExitEnabled
    }
    if (typeof body.stagnantTimeMinutes === 'number' && body.stagnantTimeMinutes >= 15) {
      updates.stagnant_time_minutes = body.stagnantTimeMinutes
    }
    if (
      typeof body.stagnantRangePct === 'number' &&
      body.stagnantRangePct > 0 &&
      body.stagnantRangePct <= 0.1
    ) {
      updates.stagnant_range_pct = body.stagnantRangePct
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const setClauses = Object.keys(updates)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(', ')
    await pool.query(
      `UPDATE user_configs SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
      [req.user!.userId, ...Object.values(updates)]
    )

    const cfg = await getUserConfig(req.user!.userId)
    res.json({ ...cfg, tradeIntervalS: cfg!.tradeIntervalMs / 1000 })
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
    if (!['admin', 'client'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or client' })
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
