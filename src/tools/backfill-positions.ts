// Backfills ai_positions from existing decisions/orders tables.
// Safe to re-run — skips entries already recorded.

import { getDb, openAiPosition, closeAiPosition, getOpenAiPositions } from '../analytics/journal.js'

const db = getDb()

const trades = db.prepare(`
  SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price
  FROM decisions d
  LEFT JOIN orders o ON o.decision_id = d.id
  WHERE d.action IN ('buy', 'sell')
    AND d.ticker IS NOT NULL
    AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
  ORDER BY d.id ASC
`).all() as Array<{
  timestamp: string
  action: 'buy' | 'sell'
  ticker: string
  quantity: number
  estimated_price: number | null
}>

const existing = new Set(
  (db.prepare(`SELECT ticker || '|' || opened_at as key FROM ai_positions`).all() as Array<{ key: string }>)
    .map(r => r.key)
)

let inserted = 0
let skipped = 0

console.log('\nBackfilling AI positions from trade history...\n')

for (const t of trades) {
  if (t.action === 'buy') {
    const key = `${t.ticker}|${t.timestamp}`
    if (existing.has(key)) { skipped++; continue }
    openAiPosition(t.ticker, t.quantity, t.estimated_price, t.timestamp)
    console.log(`  + BUY  ${t.ticker.padEnd(18)} ${String(t.quantity).padEnd(8)} @ ${t.estimated_price?.toFixed(2) ?? 'n/a'}  [${t.timestamp.slice(0, 16)}]`)
    inserted++
  } else {
    closeAiPosition(t.ticker, t.estimated_price, t.timestamp)
    console.log(`  - SELL ${t.ticker.padEnd(18)} @ ${t.estimated_price?.toFixed(2) ?? 'n/a'}  [${t.timestamp.slice(0, 16)}]`)
    inserted++
  }
}

const open = getOpenAiPositions()
console.log(`\nDone: ${inserted} inserted, ${skipped} already existed`)
console.log(`\nOpen AI positions (${open.length}):`)
for (const p of open) {
  console.log(`  ${p.ticker.padEnd(18)} ${p.quantity} shares  entry: ${p.entryPrice?.toFixed(2) ?? 'n/a'}  opened: ${p.openedAt.slice(0, 16)}`)
}
