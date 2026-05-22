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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const r = await pool.query<{
      id: number
      config_json: {
        softStopEnabled?: boolean
        softStopHoldMinutes?: number
        softStopDrawdownPct?: number
      }
      metrics_json: { trades: Trade[] }
    }>(`SELECT id, config_json, metrics_json FROM backtests ORDER BY id DESC LIMIT 6`)

    for (const row of r.rows) {
      const c = row.config_json
      console.log(`\n──── #${row.id} ────`)
      console.log(
        `softStopEnabled=${c.softStopEnabled} hold=${c.softStopHoldMinutes}m drawdown=${c.softStopDrawdownPct}`
      )
      if (!row.metrics_json) continue
      const ss = row.metrics_json.trades.filter((t) => t.exitReason === 'soft_stop')
      const sl = row.metrics_json.trades.filter((t) => t.exitReason === 'stop_loss')
      console.log(`soft_stop fires: ${ss.length}  stop_loss fires: ${sl.length}`)
      if (ss.length > 0) {
        console.log('Soft-stop trade details:')
        for (const t of ss.sort((a, b) => a.realizedPnl - b.realizedPnl)) {
          const pctDown = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100
          console.log(
            `  ${t.ticker}: ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)} (${pctDown.toFixed(2)}%, held ${(t.holdMinutes / 60).toFixed(1)}h) = €${t.realizedPnl.toFixed(2)}`
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
