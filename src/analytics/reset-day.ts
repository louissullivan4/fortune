import 'dotenv/config'
import { runMigrations } from '../db.js'
import { resetDailySnapshot } from './journal.js'

const userId = process.env.USER_ID ?? ''
if (!userId) {
  console.error('USER_ID env var is required (set to your user_id UUID)')
  process.exit(1)
}

const date =
  process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10)

async function main() {
  await runMigrations()
  await resetDailySnapshot(date, userId)
  console.log(`Daily snapshot for ${date} cleared — next cycle will record a fresh open value.`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
