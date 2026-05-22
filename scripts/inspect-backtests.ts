import 'dotenv/config'
import pg from 'pg'

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  })
  try {
    const r = await pool.query(`
      SELECT id, name, status, start_date, end_date, initial_cash, final_value,
             realized_pnl, total_return_pct, max_drawdown_pct, win_rate,
             trades_count, sharpe, config_json, metrics_json, error_message,
             created_at, completed_at
      FROM backtests
      ORDER BY id DESC
      LIMIT 10
    `)
    console.log(`Rows: ${r.rowCount}`)
    for (const row of r.rows) {
      console.log('═══════════════════════════════════════════════════════════')
      console.log(`#${row.id}  ${row.name}  [${row.status}]`)
      console.log(`Period: ${row.start_date} → ${row.end_date}`)
      console.log(
        `Cash €${row.initial_cash} → €${row.final_value ?? '?'}  P&L €${row.realized_pnl ?? '?'}  Return ${row.total_return_pct ?? '?'}%`
      )
      console.log(
        `MaxDD ${row.max_drawdown_pct ?? '?'}%  WinRate ${row.win_rate ?? '?'}  Trades ${row.trades_count ?? '?'}  Sharpe ${row.sharpe ?? '?'}`
      )
      if (row.error_message) console.log(`ERROR: ${row.error_message}`)
      const cfg = row.config_json
      console.log(
        `Config: budget €${cfg.maxBudgetEur} | pos% ${cfg.maxPositionPct} | SL ${cfg.stopLossPct} | TP ${cfg.takeProfitPct} | daily-loss ${cfg.dailyLossLimitPct} | stagnant ${cfg.stagnantTimeMinutes}m/${cfg.stagnantRangePct}`
      )
      console.log(`Universe: ${cfg.tradeUniverse.join(', ')}`)

      const m = row.metrics_json
      if (m) {
        console.log(
          `Diagnostics: cycles=${m.cyclesRun}, signalsEval=${m.signalsEvaluated}, buys=${m.buysExecuted}, sells=${m.sellsExecuted}, blockedByRisk=${m.blockedByRisk}, equityPts=${m.equityCurve?.length ?? 0}`
        )
        if (m.trades && m.trades.length > 0) {
          const exitReasons: Record<string, number> = {}
          const pnlByReason: Record<string, number[]> = {}
          const tickerStats: Record<string, { count: number; pnl: number; wins: number }> = {}
          for (const t of m.trades) {
            exitReasons[t.exitReason] = (exitReasons[t.exitReason] ?? 0) + 1
            ;(pnlByReason[t.exitReason] ??= []).push(t.realizedPnl)
            const ts = (tickerStats[t.ticker] ??= { count: 0, pnl: 0, wins: 0 })
            ts.count++
            ts.pnl += t.realizedPnl
            if (t.realizedPnl > 0) ts.wins++
          }
          console.log(`Exit reasons:`)
          for (const [k, v] of Object.entries(exitReasons)) {
            const pnls = pnlByReason[k]
            const sum = pnls.reduce((s, x) => s + x, 0)
            const avg = sum / pnls.length
            console.log(`  ${k}: ${v} trades, totalPnL €${sum.toFixed(2)}, avg €${avg.toFixed(2)}`)
          }
          console.log(`Per-ticker:`)
          for (const [t, s] of Object.entries(tickerStats)) {
            console.log(
              `  ${t}: ${s.count} trades, €${s.pnl.toFixed(2)} P&L, win-rate ${((s.wins / s.count) * 100).toFixed(0)}%`
            )
          }
          // Hold time distribution
          const holds = m.trades
            .map((t: { holdMinutes: number }) => t.holdMinutes)
            .sort((a: number, b: number) => a - b)
          const p50 = holds[Math.floor(holds.length / 2)]
          const p90 = holds[Math.floor(holds.length * 0.9)]
          console.log(
            `Hold time: median ${p50}m, p90 ${p90}m, min ${holds[0]}m, max ${holds[holds.length - 1]}m`
          )
          // Sample best/worst trades
          const sorted = [...m.trades].sort(
            (a: { realizedPnl: number }, b: { realizedPnl: number }) =>
              b.realizedPnl - a.realizedPnl
          )
          console.log(`Top 3 winners:`)
          for (const t of sorted.slice(0, 3)) {
            console.log(
              `  ${t.ticker} ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)} (${t.exitReason}, ${t.holdMinutes}m) = €${t.realizedPnl.toFixed(2)}`
            )
          }
          console.log(`Top 3 losers:`)
          for (const t of sorted.slice(-3).reverse()) {
            console.log(
              `  ${t.ticker} ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)} (${t.exitReason}, ${t.holdMinutes}m) = €${t.realizedPnl.toFixed(2)}`
            )
          }
        }
        // Equity curve stats
        if (m.equityCurve && m.equityCurve.length > 0) {
          const values = m.equityCurve.map((p: { value: number }) => p.value)
          const min = Math.min(...values)
          const max = Math.max(...values)
          console.log(
            `Equity curve: min €${min.toFixed(2)}, max €${max.toFixed(2)}, points=${values.length}`
          )
        }
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
