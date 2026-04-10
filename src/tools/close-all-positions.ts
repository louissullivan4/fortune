/**
 * close-all-positions.ts
 *
 * Pre-migration script — reads open AI positions from the existing SQLite DB
 * and sells each one via the Trading 212 API.
 *
 * Run BEFORE switching to Postgres:
 *   npx tsx src/tools/close-all-positions.ts
 *
 * After running this, all AI-tracked positions will be sold and the SQLite DB
 * will show them as closed. You can then start fresh with Postgres.
 */

import 'dotenv/config'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'

// ── Env validation ────────────────────────────────────────────────────────────

const API_KEY_ID = process.env.TRADING_212_API_KEY_ID
const API_KEY_SECRET = process.env.TRADING_212_API_KEY_SECRET
const MODE = process.env.TRADING_212_MODE ?? 'demo'
const DB_PATH = process.env.DB_PATH ?? './data/trades.db'

if (!API_KEY_ID || !API_KEY_SECRET) {
  console.error('TRADING_212_API_KEY_ID and TRADING_212_API_KEY_SECRET are required')
  process.exit(1)
}

const BASE_URL = MODE === 'live' ? 'https://live.trading212.com' : 'https://demo.trading212.com'

// ── T212 API helpers ──────────────────────────────────────────────────────────

const AUTH = Buffer.from(`${API_KEY_ID}:${API_KEY_SECRET}`).toString('base64')

async function t212<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`T212 ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

interface T212Position {
  ticker: string
  quantity: number
  currentPrice: number
}

interface PlaceOrderResult {
  id: string
  ticker: string
  status: string
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`SQLite DB not found at ${DB_PATH}`)
    console.error('Nothing to close. You can start fresh with Postgres.')
    process.exit(0)
  }

  const db = new Database(DB_PATH, { readonly: false })

  // Get open AI positions from local DB
  const openPositions = db
    .prepare(
      `SELECT id, ticker, quantity, entry_price, opened_at FROM ai_positions WHERE status = 'open' ORDER BY opened_at ASC`
    )
    .all() as Array<{
    id: number
    ticker: string
    quantity: number
    entry_price: number | null
    opened_at: string
  }>

  if (openPositions.length === 0) {
    console.log('\nNo open AI positions found in local DB. Clean slate already!\n')
    db.close()
    process.exit(0)
  }

  console.log(`\nFound ${openPositions.length} open AI position(s) in local DB:`)
  for (const p of openPositions) {
    console.log(
      `  ${p.ticker.padEnd(18)} ${p.quantity} shares  entry: ${p.entry_price?.toFixed(2) ?? 'n/a'}  opened: ${p.opened_at.slice(0, 16)}`
    )
  }

  // Fetch live portfolio from T212
  console.log(`\nFetching live portfolio from T212 (${MODE.toUpperCase()})...`)
  const livePositions = await t212<T212Position[]>('/api/v0/equity/portfolio')
  const liveMap = new Map(livePositions.map((p) => [p.ticker, p]))

  console.log(`\nPlacing sell orders...\n`)

  let sold = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const pos of openPositions) {
    const live = liveMap.get(pos.ticker)

    if (!live) {
      console.log(
        `  SKIP  ${pos.ticker} — not found in live T212 portfolio (may have already been sold)`
      )
      // Mark closed in local DB anyway
      db.prepare(
        `UPDATE ai_positions SET status = 'closed', closed_at = ?, exit_price = NULL, realized_pnl = NULL WHERE id = ?`
      ).run(now, pos.id)
      skipped++
      continue
    }

    const sellQty = live.quantity
    if (sellQty <= 0) {
      console.log(`  SKIP  ${pos.ticker} — quantity is 0`)
      skipped++
      continue
    }

    try {
      // T212 market orders: negative quantity = sell
      const order = await t212<PlaceOrderResult>('/api/v0/equity/orders/market', 'POST', {
        ticker: pos.ticker,
        quantity: -Math.abs(sellQty),
      })

      const exitPrice = live.currentPrice
      const realizedPnl = pos.entry_price != null ? (exitPrice - pos.entry_price) * sellQty : null

      db.prepare(
        `UPDATE ai_positions SET status = 'closed', closed_at = ?, exit_price = ?, realized_pnl = ? WHERE id = ?`
      ).run(now, exitPrice, realizedPnl, pos.id)

      const pnlStr =
        realizedPnl != null
          ? realizedPnl >= 0
            ? `+€${realizedPnl.toFixed(2)}`
            : `-€${Math.abs(realizedPnl).toFixed(2)}`
          : 'n/a'
      console.log(
        `  SOLD  ${pos.ticker.padEnd(18)} ${sellQty} @ €${exitPrice.toFixed(2)}  P&L: ${pnlStr}  order: ${order.id} (${order.status})`
      )
      sold++

      // Brief pause to respect T212 rate limits
      await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`  ERR   ${pos.ticker}: ${(err as Error).message}`)
    }
  }

  db.close()

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Sold: ${sold}  Skipped: ${skipped}`)
  console.log('\nAll AI positions closed. You can now start fresh with Postgres.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
