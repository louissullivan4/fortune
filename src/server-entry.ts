import 'dotenv/config'
import './config/index.js' // validates JWT_SECRET and ENCRYPTION_KEY at startup
import { runMigrations, getPool } from './db.js'
import { createHttpServer } from './server.js'
import { createEngine } from './engine/EngineService.js'
import { getOrCreateT212Client } from './api/trading212.js'
import { getUserApiKeys, getUserConfig } from './http/routes/users.js'

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err)
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)

async function autoStartEngines(): Promise<void> {
  const pool = getPool()
  const result = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM user_configs WHERE auto_start_on_restart = true'
  )
  if (result.rows.length === 0) return

  console.log(`[server] Auto-starting engines for ${result.rows.length} user(s)`)
  for (const { user_id } of result.rows) {
    try {
      const [keys, cfg] = await Promise.all([getUserApiKeys(user_id), getUserConfig(user_id)])
      if (!keys?.t212KeyId || !keys?.t212KeySecret || !keys?.anthropicApiKey || !cfg) {
        console.warn(`[server] Auto-start skipped for ${user_id} — API keys not configured`)
        continue
      }
      const t212 = getOrCreateT212Client(user_id, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
      const engine = createEngine(user_id, t212, keys.anthropicApiKey, cfg)
      await engine.start()
      console.log(`[server] Engine auto-started for user ${user_id}`)
    } catch (err) {
      console.error(`[server] Auto-start failed for ${user_id}:`, (err as Error).message)
    }
  }
}

async function main() {
  await runMigrations()

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
