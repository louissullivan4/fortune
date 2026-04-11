import 'dotenv/config'
import {
  initAiPortfolio,
  getAiPortfolioConfig,
  getAiTrades,
  getOpenAiPositions,
  getClosedAiPositions,
  getAllTimeStats,
} from './journal.js'
import { Trading212Client } from '../api/trading212.js'
import { runMigrations, getPool } from '../db.js'
import { decrypt } from '../services/encryption.js'

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

async function showPerformance(userId: string, t212: Trading212Client): Promise<void> {
  const cfg = await getAiPortfolioConfig(userId)
  if (!cfg) {
    console.log('\nAI portfolio not initialised. Run: npm run performance init\n')
    return
  }

  const [trades, openPositions, closedPositions, snapshot, allTime] = await Promise.all([
    getAiTrades(userId),
    getOpenAiPositions(userId),
    getClosedAiPositions(userId),
    t212.getPortfolioSnapshot(),
    getAllTimeStats(userId),
  ])

  const executedTrades = trades.filter(
    (t) =>
      t.orderStatus == null ||
      (!t.orderStatus.startsWith('blocked') && !t.orderStatus.startsWith('error'))
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
  console.log(`  Mode:            ${t212.mode.toUpperCase()}`)

  console.log('\n' + line())
  console.log('  ACTIVITY')
  console.log(line())
  console.log(`  Total cycles:    ${allTime.totalDecisions}`)
  console.log(
    `  Trades executed: ${executedTrades.length}  (${buys.length} buys, ${sells.length} sells)`
  )
  console.log(`  Blocked/errored: ${trades.length - executedTrades.length}`)

  if (openPositions.length > 0) {
    console.log('\n' + line())
    console.log('  OPEN POSITIONS')
    console.log(line())
    console.log(
      `  ${'Ticker'.padEnd(18)} ${'Qty'.padEnd(8)} ${'Entry'.padEnd(10)} ${'Current'.padEnd(10)} P&L`
    )
    console.log(`  ${'─'.repeat(56)}`)
    for (const p of openPositions) {
      const live = snapshot.positions.find((lp) => lp.ticker === p.ticker)
      const current = live ? `€${live.currentPrice.toFixed(2)}` : '?'
      const pnl = live
        ? live.ppl >= 0
          ? `+€${live.ppl.toFixed(2)}`
          : `-€${Math.abs(live.ppl).toFixed(2)}`
        : 'n/a'
      const entryStr = p.entryPrice ? `€${p.entryPrice.toFixed(2)}` : 'n/a'
      const pctChange =
        live && p.entryPrice
          ? (((live.currentPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(1) + '%'
          : ''
      console.log(
        `  ${p.ticker.padEnd(18)} ${String(p.quantity).padEnd(8)} ${entryStr.padEnd(10)} ${current.padEnd(10)} ${pnl} ${pctChange}`
      )
      console.log(`  ${''.padEnd(18)} opened ${p.openedAt.slice(0, 16)}`)
    }
  }

  if (closedPositions.length > 0) {
    console.log('\n' + line())
    console.log('  CLOSED POSITIONS')
    console.log(line())
    console.log(
      `  ${'Ticker'.padEnd(18)} ${'Qty'.padEnd(8)} ${'Entry'.padEnd(10)} ${'Exit'.padEnd(10)} P&L`
    )
    console.log(`  ${'─'.repeat(56)}`)
    for (const p of closedPositions) {
      const pnl =
        p.realizedPnl != null
          ? p.realizedPnl >= 0
            ? `+€${p.realizedPnl.toFixed(2)}`
            : `-€${Math.abs(p.realizedPnl).toFixed(2)}`
          : 'n/a'
      const entry = p.entryPrice ? `€${p.entryPrice.toFixed(2)}` : 'n/a'
      const exit = p.exitPrice ? `€${p.exitPrice.toFixed(2)}` : 'n/a'
      console.log(
        `  ${p.ticker.padEnd(18)} ${String(p.quantity).padEnd(8)} ${entry.padEnd(10)} ${exit.padEnd(10)} ${pnl}`
      )
      console.log(
        `  ${''.padEnd(18)} ${p.openedAt.slice(0, 16)} → ${p.closedAt?.slice(0, 16) ?? '?'}`
      )
    }
  }

  console.log('\n' + line())
  console.log('  SUMMARY')
  console.log(line())
  console.log(`  Cash deployed:   ~€${cashDeployed.toFixed(2)}`)
  console.log(`  Cash remaining:  ~€${cashRemaining.toFixed(2)}`)
  console.log(`  Unrealized P&L:  ${unrealizedPnl >= 0 ? '+' : ''}€${unrealizedPnl.toFixed(2)}`)
  console.log(`  Realized P&L:    ${realizedPnl >= 0 ? '+' : ''}€${realizedPnl.toFixed(2)}`)
  console.log(
    `  Total P&L:       ${unrealizedPnl + realizedPnl >= 0 ? '+' : ''}€${(unrealizedPnl + realizedPnl).toFixed(2)}`
  )
  console.log(line('═') + '\n')
}

async function init(userId: string, budget: number): Promise<void> {
  await initAiPortfolio(userId, budget)
  console.log(`\nAI portfolio initialised with €${budget.toFixed(2)} budget starting now.\n`)
}

if (process.argv[1]?.endsWith('performance.ts') || process.argv[1]?.endsWith('performance.js')) {
  const isInit = process.argv.includes('init')

  async function run() {
    await runMigrations()
    const { userId, t212 } = await getCliContext()
    if (isInit) {
      const budgetArg = process.argv.find((a) => /^\d+(\.\d+)?$/.test(a))
      const budget = budgetArg ? parseFloat(budgetArg) : 1000
      await init(userId, budget)
    } else {
      await showPerformance(userId, t212)
    }
    process.exit(0)
  }
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
