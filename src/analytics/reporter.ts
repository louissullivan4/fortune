import {
  getDailyStats,
  getOrdersForDay,
  getAllTimeStats,
  getRecentDecisions,
} from './journal.js'
import { getPortfolioSnapshot } from '../api/trading212.js'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function line(char = '─', len = 60): string {
  return char.repeat(len)
}

export async function dailyReport(date = today()): Promise<void> {
  const stats = getDailyStats(date)
  const trades = getOrdersForDay(date)
  const snapshot = await getPortfolioSnapshot()

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
      const pct = p.averagePrice > 0
        ? (((p.currentPrice - p.averagePrice) / p.averagePrice) * 100).toFixed(1)
        : '0.0'
      console.log(`    ${p.ticker.padEnd(12)} ${p.quantity} shares | current €${p.currentPrice.toFixed(2)} | P&L: €${p.ppl.toFixed(2)} (${pct}%)`)
    }
  }

  if (trades.length > 0) {
    console.log('\n' + line())
    console.log("  TODAY'S TRADES")
    console.log(line())
    for (const t of trades) {
      const price = t.fillPrice !== null ? `@ €${t.fillPrice.toFixed(2)}` : ''
      console.log(`  ${(t.action ?? '').toUpperCase().padEnd(5)} ${(t.ticker ?? '').padEnd(12)} ${t.quantity ?? ''}  ${price}  [${t.status ?? 'pending'}]`)
      console.log(`    → ${t.reasoning.slice(0, 100)}`)
    }
  }

  console.log('\n' + line('═') + '\n')
}

export async function fullReport(): Promise<void> {
  const stats = getAllTimeStats()
  const recent = getRecentDecisions(20)
  const snapshot = await getPortfolioSnapshot()

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
    console.log(`  [${d.timestamp.slice(0, 16)}] ${d.action.toUpperCase().padEnd(5)} ${(d.ticker ?? 'HOLD').padEnd(12)} — ${d.reasoning.slice(0, 80)}`)
  }

  console.log('\n' + line('═') + '\n')
}

// CLI entry point
if (process.argv[1]?.endsWith('reporter.ts') || process.argv[1]?.endsWith('reporter.js')) {
  const allFlag = process.argv.includes('--all')
  if (allFlag) {
    fullReport().catch(console.error)
  } else {
    const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
    dailyReport(dateArg).catch(console.error)
  }
}
