import 'dotenv/config'
import { runMigrations } from './db.js'

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
  console.log('[main] Migrations complete. Start the server with server-entry.ts.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[main] Fatal error:', err)
  process.exit(1)
})
