import {
  initAiPortfolio,
  getAiPortfolioConfig,
  getAiTrades,
  getOpenAiPositions,
  getClosedAiPositions,
  getAllTimeStats,
} from './journal.js'
import { getPortfolioSnapshot } from '../api/trading212.js'
import { config } from '../config/index.js'

function line(char = '─', len = 60): string {
  return char.repeat(len)
}

async function showPerformance(): Promise<void> {
  const cfg = getAiPortfolioConfig()
  if (!cfg) {
    console.log('\nAI portfolio not initialised. Run: npm run performance init\n')
    return
  }

  const trades = getAiTrades()
  const openPositions = getOpenAiPositions()
  const closedPositions = getClosedAiPositions()
  const snapshot = await getPortfolioSnapshot()
  const allTime = getAllTimeStats()

  const executedTrades = trades.filter(
    (t) => t.orderStatus == null || (!t.orderStatus.startsWith('blocked') && !t.orderStatus.startsWith('error'))
  )
  const buys = executedTrades.filter((t) => t.action === 'buy')
  const sells = executedTrades.filter((t) => t.action === 'sell')

  const cashDeployed = buys.reduce((sum, t) => sum + (t.estimatedValue ?? 0), 0)
  const cashReturned = sells.reduce((sum, t) => sum + (t.estimatedValue ?? 0), 0)
  const cashRemaining = cfg.initialBudget - cashDeployed + cashReturned

  const unrealizedPnl = openPositions.reduce((sum, p) => {
    const live = snapshot.positions.find((lp) => lp.ticker === p.ticker)
    return sum + (live?.ppl ?? 0)
  }, 0)

  const realizedPnl = closedPositions.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)

  console.log('\n' + line('═'))
  console.log('  AI PORTFOLIO PERFORMANCE')
  console.log(line('═'))
  console.log(`  Started:         ${cfg.startedAt.slice(0, 10)}`)
  console.log(`  Initial budget:  €${cfg.initialBudget.toFixed(2)}`)
  console.log(`  Mode:            ${config.trading212Mode.toUpperCase()}`)

  console.log('\n' + line())
  console.log('  ACTIVITY')
  console.log(line())
  console.log(`  Total cycles:    ${allTime.totalDecisions}`)
  console.log(`  Trades executed: ${executedTrades.length}  (${buys.length} buys, ${sells.length} sells)`)
  console.log(`  Blocked/errored: ${trades.length - executedTrades.length}`)

  if (openPositions.length > 0) {
    console.log('\n' + line())
    console.log('  OPEN POSITIONS')
    console.log(line())
    console.log(`  ${'Ticker'.padEnd(18)} ${'Qty'.padEnd(8)} ${'Entry'.padEnd(10)} ${'Current'.padEnd(10)} P&L`)
    console.log(`  ${'─'.repeat(56)}`)
    for (const p of openPositions) {
      const live = snapshot.positions.find((lp) => lp.ticker === p.ticker)
      const current = live ? `€${live.currentPrice.toFixed(2)}` : '?'
      const pnl = live ? (live.ppl >= 0 ? `+€${live.ppl.toFixed(2)}` : `-€${Math.abs(live.ppl).toFixed(2)}`) : 'n/a'
      const entryStr = p.entryPrice ? `€${p.entryPrice.toFixed(2)}` : 'n/a'
      const pctChange = live && p.entryPrice
        ? ((live.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) + '%'
        : ''
      console.log(`  ${p.ticker.padEnd(18)} ${String(p.quantity).padEnd(8)} ${entryStr.padEnd(10)} ${current.padEnd(10)} ${pnl} ${pctChange}`)
      console.log(`  ${''.padEnd(18)} opened ${p.openedAt.slice(0, 16)}`)
    }
  }

  if (closedPositions.length > 0) {
    console.log('\n' + line())
    console.log('  CLOSED POSITIONS')
    console.log(line())
    console.log(`  ${'Ticker'.padEnd(18)} ${'Qty'.padEnd(8)} ${'Entry'.padEnd(10)} ${'Exit'.padEnd(10)} P&L`)
    console.log(`  ${'─'.repeat(56)}`)
    for (const p of closedPositions) {
      const pnl = p.realizedPnl != null
        ? (p.realizedPnl >= 0 ? `+€${p.realizedPnl.toFixed(2)}` : `-€${Math.abs(p.realizedPnl).toFixed(2)}`)
        : 'n/a'
      const entry = p.entryPrice ? `€${p.entryPrice.toFixed(2)}` : 'n/a'
      const exit = p.exitPrice ? `€${p.exitPrice.toFixed(2)}` : 'n/a'
      console.log(`  ${p.ticker.padEnd(18)} ${String(p.quantity).padEnd(8)} ${entry.padEnd(10)} ${exit.padEnd(10)} ${pnl}`)
      console.log(`  ${''.padEnd(18)} ${p.openedAt.slice(0, 16)} → ${p.closedAt?.slice(0, 16) ?? '?'}`)
    }
  }

  console.log('\n' + line())
  console.log('  SUMMARY')
  console.log(line())
  console.log(`  Cash deployed:   ~€${cashDeployed.toFixed(2)}`)
  console.log(`  Cash remaining:  ~€${cashRemaining.toFixed(2)}`)
  console.log(`  Unrealized P&L:  ${unrealizedPnl >= 0 ? '+' : ''}€${unrealizedPnl.toFixed(2)}`)
  console.log(`  Realized P&L:    ${realizedPnl >= 0 ? '+' : ''}€${realizedPnl.toFixed(2)}`)
  console.log(`  Total P&L:       ${(unrealizedPnl + realizedPnl) >= 0 ? '+' : ''}€${(unrealizedPnl + realizedPnl).toFixed(2)}`)
  console.log(line('═') + '\n')
}

async function init(): Promise<void> {
  const budgetArg = process.argv.find((a) => /^\d+(\.\d+)?$/.test(a))
  const budget = budgetArg ? parseFloat(budgetArg) : config.maxBudgetEur
  initAiPortfolio(budget)
  console.log(`\nAI portfolio initialised with €${budget.toFixed(2)} budget starting now.\n`)
}

if (process.argv[1]?.endsWith('performance.ts') || process.argv[1]?.endsWith('performance.js')) {
  const isInit = process.argv.includes('init')
  if (isInit) {
    init().catch(console.error)
  } else {
    showPerformance().catch(console.error)
  }
}
