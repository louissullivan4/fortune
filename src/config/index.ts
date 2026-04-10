import 'dotenv/config'
import { z } from 'zod'
import { getPool } from '../db.js'

// ── Secrets — from env vars (never stored in DB) ────────────────────────────

const SecretsSchema = z.object({
  anthropicApiKey: z.string().min(10, 'ANTHROPIC_API_KEY is required'),
  trading212ApiKeyId: z.string().min(1, 'TRADING_212_API_KEY_ID is required'),
  trading212ApiKeySecret: z.string().min(1, 'TRADING_212_API_KEY_SECRET is required'),
  trading212Mode: z.enum(['live', 'demo']).default('demo'),
})

const secretsResult = SecretsSchema.safeParse({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  trading212ApiKeyId: process.env.TRADING_212_API_KEY_ID,
  trading212ApiKeySecret: process.env.TRADING_212_API_KEY_SECRET,
  trading212Mode: process.env.TRADING_212_MODE,
})

if (!secretsResult.success) {
  console.error('Configuration error:')
  secretsResult.error.issues.forEach((i) => console.error(`  ${i.path.join('.')}: ${i.message}`))
  process.exit(1)
}

const secrets = secretsResult.data

// ── Exported config object ──────────────────────────────────────────────────

export interface Config {
  // Secrets (env vars, immutable at runtime)
  anthropicApiKey: string
  trading212ApiKeyId: string
  trading212ApiKeySecret: string
  trading212Mode: 'live' | 'demo'
  // Mutable (DB-backed, persisted on every updateConfig call)
  tradeUniverse: string[]
  tradeIntervalMs: number
  maxBudgetEur: number
  maxPositionPct: number
  dailyLossLimitPct: number
  stopLossPct: number
  takeProfitPct: number
}

// Start with env-var defaults; initConfig() will overwrite with DB values.
export const config: Config = {
  ...secrets,
  tradeUniverse: (
    process.env.TRADE_UNIVERSE ??
    'AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,VOD_l,BP_l,SHEL_l,RIO_l,BARC_l,LLOY_l,AZN_l'
  )
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  tradeIntervalMs: process.env.TRADE_INTERVAL_S
    ? Number(process.env.TRADE_INTERVAL_S) * 1000
    : Number(process.env.TRADE_INTERVAL_MS ?? 900_000),
  maxBudgetEur: Number(process.env.MAX_BUDGET_EUR ?? 100),
  maxPositionPct: Number(process.env.MAX_POSITION_PCT ?? 0.25),
  dailyLossLimitPct: Number(process.env.DAILY_LOSS_LIMIT_PCT ?? 0.1),
  stopLossPct: Number(process.env.STOP_LOSS_PCT ?? 0.05),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT ?? 0.015),
}

// ── initConfig — call once at startup after runMigrations() ────────────────
// Loads DB-backed config from Postgres, seeding from env vars on first run.

export async function initConfig(): Promise<void> {
  const pool = getPool()

  let row = (
    await pool.query<{
      trade_universe: string
      trade_interval_ms: number
      max_budget_eur: number
      max_position_pct: number
      daily_loss_limit_pct: number
      stop_loss_pct: number
      take_profit_pct: number
    }>('SELECT * FROM app_config WHERE id = 1')
  ).rows[0]

  if (!row) {
    await pool.query(
      `INSERT INTO app_config
         (id, trade_universe, trade_interval_ms, max_budget_eur, max_position_pct, daily_loss_limit_pct, stop_loss_pct, take_profit_pct, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        config.tradeUniverse.join(','),
        config.tradeIntervalMs,
        config.maxBudgetEur,
        config.maxPositionPct,
        config.dailyLossLimitPct,
        config.stopLossPct,
        config.takeProfitPct,
        new Date().toISOString(),
      ]
    )
    console.log('[config] app_config seeded from env vars')
    row = (await pool.query('SELECT * FROM app_config WHERE id = 1')).rows[0]
  }

  config.tradeUniverse = row.trade_universe
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  config.tradeIntervalMs = Number(row.trade_interval_ms)
  config.maxBudgetEur = Number(row.max_budget_eur)
  config.maxPositionPct = Number(row.max_position_pct)
  config.dailyLossLimitPct = Number(row.daily_loss_limit_pct)
  config.stopLossPct = Number(row.stop_loss_pct)
  config.takeProfitPct = Number(row.take_profit_pct)
}

// ── updateConfig — mutates in-memory config AND persists to DB ──────────────

export type ConfigUpdate = Partial<
  Pick<
    Config,
    | 'tradeUniverse'
    | 'tradeIntervalMs'
    | 'maxBudgetEur'
    | 'maxPositionPct'
    | 'dailyLossLimitPct'
    | 'stopLossPct'
    | 'takeProfitPct'
  >
>

export async function updateConfig(updates: ConfigUpdate): Promise<void> {
  Object.assign(config, updates)
  const pool = getPool()
  await pool.query(
    `UPDATE app_config SET
       trade_universe       = COALESCE($1, trade_universe),
       trade_interval_ms    = COALESCE($2, trade_interval_ms),
       max_budget_eur       = COALESCE($3, max_budget_eur),
       max_position_pct     = COALESCE($4, max_position_pct),
       daily_loss_limit_pct = COALESCE($5, daily_loss_limit_pct),
       stop_loss_pct        = COALESCE($6, stop_loss_pct),
       take_profit_pct      = COALESCE($7, take_profit_pct),
       updated_at           = $8
     WHERE id = 1`,
    [
      updates.tradeUniverse ? updates.tradeUniverse.join(',') : null,
      updates.tradeIntervalMs ?? null,
      updates.maxBudgetEur ?? null,
      updates.maxPositionPct ?? null,
      updates.dailyLossLimitPct ?? null,
      updates.stopLossPct ?? null,
      updates.takeProfitPct ?? null,
      new Date().toISOString(),
    ]
  )
}
