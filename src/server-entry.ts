import 'dotenv/config'
import './config/index.js' // validates JWT_SECRET and ENCRYPTION_KEY at startup
import { runMigrations } from './db.js'
import { createHttpServer } from './server.js'

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err)
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)

async function main() {
  await runMigrations()

  const server = createHttpServer()
  server.listen(PORT, () => {
    console.log(`[server] API listening on http://localhost:${PORT}`)
    console.log(`[server] WebSocket on ws://localhost:${PORT}/ws`)
    console.log(`[server] Health check: http://localhost:${PORT}/health`)
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
