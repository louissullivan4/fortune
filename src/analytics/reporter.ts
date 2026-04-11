import 'dotenv/config'
import { getDailyStats, getOrdersForDay, getAllTimeStats, getRecentDecisions } from './journal.js'
import { Trading212Client } from '../api/trading212.js'
import { runMigrations, getPool } from '../db.js'
import { decrypt } from '../services/encryption.js'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function line(char = '─', len = 60): string {
  return char.repeat(len)
}

async function getCliContext(): Promise<{ userId: string; t212: Trading212Client }> {
  const userId = process.env.USER_ID
  if (!userId) {
    console.error('USER_ID env var is required (set to your user_id UUID)')
    process.exit(1)
  }
  const pool = getPool()
  const res = await pool.query<{
    t212_key_id_enc: string | null
    t212_key_secret_enc: string | null
    t212_mode: string
  }>('SELECT t212_key_id_enc, t212_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1', [userId])
  const row = res.rows[0]
  if (!row?.t212_key_id_enc || !row?.t212_key_secret_enc) {
    console.error('No T212 API keys found for this user. Set them via the web UI.')
    process.exit(1)
  }
  const t212 = new Trading212Client(
    decrypt(row.t212_key_id_enc),
    decrypt(row.t212_key_secret_enc),
    (row.t212_mode ?? 'demo') as 'demo' | 'live'
  )
  return { userId, t212 }
}

export async function dailyReport(userId: string, t212: Trading212Client, date = today()): Promise<void> {
  const [stats, trades, snapshot] = await Promise.all([
    getDailyStats(date, userId),
    getOrdersForDay(date, userId),
    t212.getPortfolioSnapshot(),
  ])

  console.log('\n' + line('═'))
  console.log(`  TRADER DAILY REPORT — ${date}`)
  console.log(line('═'))

  if (!stats) {
    console.log('  No data for this date yet.')
  } else {
    const pnl = stats.pnl !== null ? `€${stats.pnl.toFixed(2)}` : 'n/a'
    const closeVal = stats.closeValue !== null ? `€${stats.closeValue.toFixed(2)}` : 'n/a'
    console.log(`  Open value:   €${stats.openValue.toFixed(2)}`)
    console.log(`  Close value:  ${closeVal}`)
    console.log(`  Day P&L:      ${pnl}`)
    console.log(`  Trades made:  ${stats.tradesCount}`)
  }

  console.log('\n' + line())
  console.log('  LIVE PORTFOLIO')
  console.log(line())
  console.log(`  Total value:  €${snapshot.totalValue.toFixed(2)}`)
  console.log(`  Free cash:    €${snapshot.cash.free.toFixed(2)}`)
  console.log(`  All-time P&L: €${snapshot.totalPpl.toFixed(2)}`)

  if (snapshot.positions.length > 0) {
    console.log('\n  Positions:')
    for (const p of snapshot.positions) {
      const pct =
        p.averagePrice > 0
          ? (((p.currentPrice - p.averagePrice) / p.averagePrice) * 100).toFixed(1)
          : '0.0'
      console.log(
        `    ${p.ticker.padEnd(12)} ${p.quantity} shares | current €${p.currentPrice.toFixed(2)} | P&L: €${p.ppl.toFixed(2)} (${pct}%)`
      )
    }
  }

  if (trades.length > 0) {
    console.log('\n' + line())
    console.log("  TODAY'S TRADES")
    console.log(line())
    for (const t of trades) {
      const price = t.fillPrice !== null ? `@ €${t.fillPrice.toFixed(2)}` : ''
      console.log(
        `  ${(t.action ?? '').toUpperCase().padEnd(5)} ${(t.ticker ?? '').padEnd(12)} ${t.quantity ?? ''}  ${price}  [${t.status ?? 'pending'}]`
      )
      console.log(`    → ${t.reasoning.slice(0, 100)}`)
    }
  }

  console.log('\n' + line('═') + '\n')
}

export async function fullReport(userId: string, t212: Trading212Client): Promise<void> {
  const [stats, recent, snapshot] = await Promise.all([
    getAllTimeStats(userId),
    getRecentDecisions(userId, 20),
    t212.getPortfolioSnapshot(),
  ])

  console.log('\n' + line('═'))
  console.log('  TRADER ALL-TIME REPORT')
  console.log(line('═'))
  console.log(`  Days traded:       ${stats.daysTraded}`)
  console.log(`  Total decisions:   ${stats.totalDecisions}`)
  console.log(`  Actual trades:     ${stats.totalTrades}`)
  console.log(`  Current value:     €${snapshot.totalValue.toFixed(2)}`)
  console.log(`  All-time P&L:      €${snapshot.totalPpl.toFixed(2)}`)

  console.log('\n' + line())
  console.log('  RECENT DECISIONS (last 20)')
  console.log(line())
  for (const d of recent) {
    console.log(
      `  [${d.timestamp.slice(0, 16)}] ${d.action.toUpperCase().padEnd(5)} ${(d.ticker ?? 'HOLD').padEnd(12)} — ${d.reasoning.slice(0, 80)}`
    )
  }

  console.log('\n' + line('═') + '\n')
}

// CLI entry point
if (process.argv[1]?.endsWith('reporter.ts') || process.argv[1]?.endsWith('reporter.js')) {
  const allFlag = process.argv.includes('--all')
  const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))

  async function run() {
    await runMigrations()
    const { userId, t212 } = await getCliContext()
    if (allFlag) {
      await fullReport(userId, t212)
    } else {
      await dailyReport(userId, t212, dateArg)
    }
    process.exit(0)
  }
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
