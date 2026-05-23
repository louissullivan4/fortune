import 'dotenv/config'
import pg from 'pg'

interface Trade {
  ticker: string
  openedAt: string
  closedAt: string
  quantity: number
  entryPrice: number
  exitPrice: number
  realizedPnl: number
  exitReason: string
  holdMinutes: number
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  })
  try {
    const targetId = parseInt(process.argv[2] ?? '13', 10)
    const r = await pool.query<{
      metrics_json: { trades: Trade[]; equityCurve: Array<{ t: number; value: number }> }
    }>(`SELECT metrics_json FROM backtests WHERE id = $1`, [targetId])
    const m = r.rows[0].metrics_json
    const trades = m.trades

    // 1) Risk-reward analysis
    const wins = trades.filter((t) => t.realizedPnl > 0)
    const losses = trades.filter((t) => t.realizedPnl < 0)
    const avgWin = wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length
    const avgLoss = losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length
    const winRate = wins.length / (wins.length + losses.length)
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss
    const requiredWinRate = -avgLoss / (avgWin - avgLoss)
    console.log('═══ Risk/reward ═══')
    console.log(`avgWin €${avgWin.toFixed(3)}  avgLoss €${avgLoss.toFixed(3)}`)
    console.log(`ratio: 1 : ${(avgWin / -avgLoss).toFixed(2)}`)
    console.log(
      `win-rate ${(winRate * 100).toFixed(1)}%  break-even need ${(requiredWinRate * 100).toFixed(1)}%`
    )
    console.log(`expectancy per trade €${expectancy.toFixed(3)}`)

    // 2) Stagnant rotation drain
    const stag = trades.filter((t) => t.exitReason === 'stagnant_rotation')
    const stagPnl = stag.reduce((s, t) => s + t.realizedPnl, 0)
    const stagWinners = stag.filter((t) => t.realizedPnl > 0)
    const stagLosers = stag.filter((t) => t.realizedPnl < 0)
    console.log('\n═══ Stagnant rotations ═══')
    console.log(
      `count ${stag.length}  totalPnL €${stagPnl.toFixed(2)}  winners ${stagWinners.length}  losers ${stagLosers.length}`
    )
    console.log(
      `Median hold ${stag.map((t) => t.holdMinutes).sort((a, b) => a - b)[Math.floor(stag.length / 2)]}m`
    )

    // 3) Per-ticker reputation across all 3 runs
    const allRuns = await pool.query<{ metrics_json: { trades: Trade[] } }>(
      `SELECT metrics_json FROM backtests WHERE metrics_json IS NOT NULL`
    )
    const tickerAgg: Record<
      string,
      { trades: number; pnl: number; wins: number; slCount: number }
    > = {}
    for (const row of allRuns.rows) {
      for (const t of row.metrics_json.trades) {
        const a = (tickerAgg[t.ticker] ??= { trades: 0, pnl: 0, wins: 0, slCount: 0 })
        a.trades++
        a.pnl += t.realizedPnl
        if (t.realizedPnl > 0) a.wins++
        if (t.exitReason === 'stop_loss') a.slCount++
      }
    }
    console.log('\n═══ Ticker reputation (all runs combined) ═══')
    const ranked = Object.entries(tickerAgg).sort((a, b) => b[1].pnl - a[1].pnl)
    console.log('Top earners:')
    for (const [t, a] of ranked.slice(0, 5)) {
      console.log(
        `  ${t}: ${a.trades} trades, €${a.pnl.toFixed(2)}, win-rate ${((a.wins / a.trades) * 100).toFixed(0)}%, SLs ${a.slCount}`
      )
    }
    console.log('Worst losers:')
    for (const [t, a] of ranked.slice(-5).reverse()) {
      console.log(
        `  ${t}: ${a.trades} trades, €${a.pnl.toFixed(2)}, win-rate ${((a.wins / a.trades) * 100).toFixed(0)}%, SLs ${a.slCount}`
      )
    }

    // 4) Time-to-stop distribution for losers
    const slTrades = trades.filter((t) => t.exitReason === 'stop_loss')
    console.log('\n═══ Stop-loss timing (run #2) ═══')
    for (const t of slTrades.sort((a, b) => a.holdMinutes - b.holdMinutes)) {
      console.log(
        `  ${t.ticker}: held ${(t.holdMinutes / 60).toFixed(1)}h, entry €${t.entryPrice.toFixed(2)} → SL €${t.exitPrice.toFixed(2)} (€${t.realizedPnl.toFixed(2)})`
      )
    }

    // 5) Win-types — TP vs trailing
    const tp = trades.filter((t) => t.exitReason === 'take_profit')
    const ts = trades.filter((t) => t.exitReason === 'trailing_stop')
    console.log('\n═══ Winner exit types ═══')
    console.log(
      `take_profit: ${tp.length} (€${tp.reduce((s, t) => s + t.realizedPnl, 0).toFixed(2)})  median hold ${tp.map((t) => t.holdMinutes).sort((a, b) => a - b)[Math.floor(tp.length / 2)]}m`
    )
    console.log(
      `trailing_stop: ${ts.length} (€${ts.reduce((s, t) => s + t.realizedPnl, 0).toFixed(2)})  median hold ${ts.map((t) => t.holdMinutes).sort((a, b) => a - b)[Math.floor(ts.length / 2)]}m`
    )
    const tsWins = ts.filter((t) => t.realizedPnl > 0)
    const tsLosses = ts.filter((t) => t.realizedPnl <= 0)
    console.log(
      `  trailing winners: ${tsWins.length} avg €${(tsWins.reduce((s, t) => s + t.realizedPnl, 0) / tsWins.length).toFixed(3)}`
    )
    console.log(
      `  trailing losers/flat: ${tsLosses.length} avg €${(tsLosses.reduce((s, t) => s + t.realizedPnl, 0) / Math.max(1, tsLosses.length)).toFixed(3)}`
    )

    // 6) Drawdown chronology
    const eq = m.equityCurve
    let peak = eq[0].value
    let maxDdValue = 0
    let maxDdAt = 0
    for (const p of eq) {
      if (p.value > peak) peak = p.value
      const dd = (peak - p.value) / peak
      if (dd > maxDdValue) {
        maxDdValue = dd
        maxDdAt = p.t
      }
    }
    console.log('\n═══ Drawdown ═══')
    console.log(`Peak equity €${peak.toFixed(2)}`)
    console.log(
      `Max DD ${(maxDdValue * 100).toFixed(2)}% at ${new Date(maxDdAt).toISOString().slice(0, 16)}`
    )
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
