import 'dotenv/config'
import { z } from 'zod'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

// ── Secrets — still from env vars (never stored in DB) ─────────────────────

const SecretsSchema = z.object({
  anthropicApiKey:        z.string().min(10, 'ANTHROPIC_API_KEY is required'),
  trading212ApiKeyId:     z.string().min(1,  'TRADING_212_API_KEY_ID is required'),
  trading212ApiKeySecret: z.string().min(1,  'TRADING_212_API_KEY_SECRET is required'),
  trading212Mode:         z.enum(['live', 'demo']).default('demo'),
  dbPath:                 z.string().default('./data/trades.db'),
})

const secretsResult = SecretsSchema.safeParse({
  anthropicApiKey:        process.env.ANTHROPIC_API_KEY,
  trading212ApiKeyId:     process.env.TRADING_212_API_KEY_ID,
  trading212ApiKeySecret: process.env.TRADING_212_API_KEY_SECRET,
  trading212Mode:         process.env.TRADING_212_MODE,
  dbPath:                 process.env.DB_PATH,
})

if (!secretsResult.success) {
  console.error('Configuration error:')
  secretsResult.error.issues.forEach((i) => console.error(`  ${i.path.join('.')}: ${i.message}`))
  process.exit(1)
}

const secrets = secretsResult.data

// ── DB-backed mutable config ────────────────────────────────────────────────
// Stored in the app_config table. Changes made via the UI persist across restarts.
// On first run the table is seeded from env vars (migration path) then env vars
// are no longer read for these values.

mkdirSync(dirname(secrets.dbPath), { recursive: true })
const _cfgDb = new Database(secrets.dbPath)
_cfgDb.pragma('journal_mode = WAL')

_cfgDb.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    trade_universe      TEXT    NOT NULL,
    trade_interval_ms   INTEGER NOT NULL,
    max_budget_eur      REAL    NOT NULL,
    max_position_pct    REAL    NOT NULL,
    daily_loss_limit_pct REAL   NOT NULL,
    updated_at          TEXT    NOT NULL
  )
`)

interface DbConfigRow {
  trade_universe:       string
  trade_interval_ms:    number
  max_budget_eur:       number
  max_position_pct:     number
  daily_loss_limit_pct: number
}

// Seed defaults from env vars (one-time migration) if no row exists yet
if (!_cfgDb.prepare(`SELECT id FROM app_config WHERE id = 1`).get()) {
  const intervalMs = process.env.TRADE_INTERVAL_S
    ? Number(process.env.TRADE_INTERVAL_S) * 1000
    : Number(process.env.TRADE_INTERVAL_MS ?? 900_000)

  _cfgDb.prepare(`
    INSERT INTO app_config
      (id, trade_universe, trade_interval_ms, max_budget_eur, max_position_pct, daily_loss_limit_pct, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(
    process.env.TRADE_UNIVERSE
      ?? 'AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,VOD_l,BP_l,SHEL_l,RIO_l,BARC_l,LLOY_l,AZN_l',
    intervalMs,
    Number(process.env.MAX_BUDGET_EUR      ?? 100),
    Number(process.env.MAX_POSITION_PCT    ?? 0.25),
    Number(process.env.DAILY_LOSS_LIMIT_PCT ?? 0.10),
    new Date().toISOString(),
  )
  console.log('[config] app_config seeded from env vars — env vars for these fields can now be removed')
}

const _row = _cfgDb.prepare(`SELECT * FROM app_config WHERE id = 1`).get() as DbConfigRow

// ── Exported config object ──────────────────────────────────────────────────

export interface Config {
  // Secrets (env vars, immutable at runtime)
  anthropicApiKey:        string
  trading212ApiKeyId:     string
  trading212ApiKeySecret: string
  trading212Mode:         'live' | 'demo'
  dbPath:                 string
  // Mutable (DB-backed, persisted on every updateConfig call)
  tradeUniverse:      string[]
  tradeIntervalMs:    number
  maxBudgetEur:       number
  maxPositionPct:     number
  dailyLossLimitPct:  number
}

export const config: Config = {
  ...secrets,
  tradeUniverse:     _row.trade_universe.split(',').map((t) => t.trim()).filter(Boolean),
  tradeIntervalMs:   _row.trade_interval_ms,
  maxBudgetEur:      _row.max_budget_eur,
  maxPositionPct:    _row.max_position_pct,
  dailyLossLimitPct: _row.daily_loss_limit_pct,
}

// ── updateConfig — mutates in-memory config AND persists to DB ──────────────

export type ConfigUpdate = Partial<Pick<Config,
  'tradeUniverse' | 'tradeIntervalMs' | 'maxBudgetEur' | 'maxPositionPct' | 'dailyLossLimitPct'
>>

export function updateConfig(updates: ConfigUpdate): void {
  Object.assign(config, updates)
  _cfgDb.prepare(`
    UPDATE app_config SET
      trade_universe       = COALESCE(?, trade_universe),
      trade_interval_ms    = COALESCE(?, trade_interval_ms),
      max_budget_eur       = COALESCE(?, max_budget_eur),
      max_position_pct     = COALESCE(?, max_position_pct),
      daily_loss_limit_pct = COALESCE(?, daily_loss_limit_pct),
      updated_at           = ?
    WHERE id = 1
  `).run(
    updates.tradeUniverse  ? updates.tradeUniverse.join(',') : null,
    updates.tradeIntervalMs    ?? null,
    updates.maxBudgetEur       ?? null,
    updates.maxPositionPct     ?? null,
    updates.dailyLossLimitPct  ?? null,
    new Date().toISOString(),
  )
}
