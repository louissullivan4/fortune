import 'dotenv/config'
import { runMigrations } from './db.js'
import { initConfig } from './config/index.js'
import { startLoop } from './engine/scheduler.js'

process.on('SIGTERM', () => {
  console.log('[main] SIGTERM received — shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('\n[main] SIGINT received — shutting down')
  process.exit(0)
})

async function main() {
  await runMigrations()
  await initConfig()
  await startLoop()
}

main().catch((err) => {
  console.error('[main] Fatal error:', err)
  process.exit(1)
})
