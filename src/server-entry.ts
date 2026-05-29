import 'dotenv/config'
import './config/index.js' // validates JWT_SECRET and ENCRYPTION_KEY at startup
import { runMigrations, getPool } from './db.js'
import { createHttpServer } from './server.js'
import { createEngine } from './engine/EngineService.js'
import { getOrCreateT212Client } from './api/trading212.js'
import { getUserApiKeys, getUserMarketConfig } from './http/routes/users.js'
import { getMarketSpec } from './markets/registry.js'
import { installDbFxPersistence } from './api/fx-persistence.js'
import { seedFxCacheFromDb } from './api/fx.js'

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err)
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)

async function autoStartEngines(): Promise<void> {
  const pool = getPool()
  const result = await pool.query<{ user_id: string; market_code: string }>(
    'SELECT user_id, market_code FROM user_market_configs WHERE auto_start_on_restart = true'
  )
  if (result.rows.length === 0) return

  console.log(
    `[server] Auto-starting engines for ${result.rows.length} (user, market) combination(s)`
  )
  for (const { user_id, market_code } of result.rows) {
    try {
      const [keys, cfg] = await Promise.all([
        getUserApiKeys(user_id),
        getUserMarketConfig(user_id, market_code),
      ])
      if (!keys?.t212KeyId || !keys?.t212KeySecret || !keys?.anthropicApiKey || !cfg) {
        console.warn(
          `[server] Auto-start skipped for ${user_id}/${market_code} — API keys not configured`
        )
        continue
      }
      const t212 = getOrCreateT212Client(user_id, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
      const spec = getMarketSpec(market_code)
      const engine = createEngine(user_id, spec, t212, keys.anthropicApiKey, cfg)
      await engine.start()
      console.log(`[server] Engine auto-started for user ${user_id} / ${market_code}`)
    } catch (err) {
      console.error(
        `[server] Auto-start failed for ${user_id}/${market_code}:`,
        (err as Error).message
      )
    }
  }
}

async function main() {
  await runMigrations()

  // FX: persist resolved rates and seed the in-memory cache from the DB so a
  // transient Frankfurter failure (or this fresh process) never falls back to
  // a 1.0 rate that would record native value as EUR.
  installDbFxPersistence()
  await seedFxCacheFromDb()

  const server = createHttpServer()
  server.listen(PORT, () => {
    console.log(`[server] API listening on http://localhost:${PORT}`)
    console.log(`[server] WebSocket on ws://localhost:${PORT}/ws`)
    console.log(`[server] Health check: http://localhost:${PORT}/health`)
    autoStartEngines().catch((err) =>
      console.error('[server] Auto-start error:', (err as Error).message)
    )
  })

  function shutdown(signal: string) {
    console.log(`\n[server] ${signal} — shutting down`)
    const timer = setTimeout(() => process.exit(0), 2000)
    timer.unref()
    server.close(() => process.exit(0))
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[server] Startup error:', err)
  process.exit(1)
})
