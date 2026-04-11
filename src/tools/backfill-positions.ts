// Backfills ai_positions from existing decisions/orders tables.
// Safe to re-run — skips entries already recorded.

import 'dotenv/config'
import { runMigrations } from '../db.js'
import { reconcileAiPositions, getOpenAiPositions } from '../analytics/journal.js'

const userId = process.env.USER_ID ?? ''
if (!userId) {
  console.error('USER_ID env var is required (set to your user_id UUID)')
  process.exit(1)
}

async function main() {
  await runMigrations()

  console.log('\nBackfilling AI positions from trade history...\n')
  const { inserted } = await reconcileAiPositions(userId)

  const open = await getOpenAiPositions(userId)
  console.log(`\nDone: ${inserted} inserted/updated`)
  console.log(`\nOpen AI positions (${open.length}):`)
  for (const p of open) {
    console.log(
      `  ${p.ticker.padEnd(18)} ${p.quantity} shares  entry: ${p.entryPrice?.toFixed(2) ?? 'n/a'}  opened: ${p.openedAt.slice(0, 16)}`
    )
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
