import 'dotenv/config'
import { runMigrations, closePool } from './db.js'

console.log('[migrate] Running database migrations...')

runMigrations()
  .then(() => {
    console.log('[migrate] All migrations applied')
    return closePool()
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] Migration failed:', err)
    process.exit(1)
  })
