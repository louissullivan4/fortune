import { getAllHistoriesRange } from '../api/marketdata.js'
import { hub } from '../ws/hub.js'
import { runBacktest } from './simulator.js'
import { getBacktest, updateBacktestProgress, completeBacktest, failBacktest } from './journal.js'

// Single in-process queue. Backtests are CPU-bound but short — running one at
// a time per server keeps memory predictable and avoids contention.
const queue: number[] = []
let busy = false

export function enqueueBacktest(id: number): void {
  queue.push(id)
  void drain()
}

async function drain(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      try {
        await execute(id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[backtest] runner failed for id=${id}: ${msg}`)
        try {
          await failBacktest(id, msg)
        } catch {
          /* already logged */
        }
        hub.broadcast('backtest_done', { id, status: 'failed', error: msg })
      }
    }
  } finally {
    busy = false
  }
}

async function execute(id: number): Promise<void> {
  // Re-read the row inside the runner so the runner is self-contained — caller
  // only needs to pass the id.
  const row = await getBacktest(id, await ownerOf(id))
  if (!row) throw new Error(`backtest ${id} not found`)
  const config = row.configJson

  // Warm-up: pull an extra 30 days before startDate so signals (which need
  // ≥50 bars) are valid at the very first cycle.
  const start = new Date(config.startDate + 'T00:00:00Z')
  const end = new Date(config.endDate + 'T23:59:59Z')
  const warmup = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000)

  await updateBacktestProgress(id, 0)
  hub.broadcast('backtest_progress', { id, progressPct: 0 })

  const histories = await getAllHistoriesRange(config.tradeUniverse, warmup, end, '1h')

  // Fail fast if Yahoo returned empty data for every ticker (commonly a bad
  // date range or rate limiting)
  const totalBars = [...histories.values()].reduce((s, h) => s + h.bars.length, 0)
  if (totalBars === 0) {
    throw new Error(
      `No market data returned for any ticker in [${config.tradeUniverse.join(', ')}] over ${config.startDate}..${config.endDate}. Yahoo hourly history is limited to ~730 days.`
    )
  }

  let lastReportedPct = 0
  const metrics = await runBacktest(config, histories, (pct) => {
    if (pct === lastReportedPct) return
    lastReportedPct = pct
    void updateBacktestProgress(id, pct).catch(() => {})
    hub.broadcast('backtest_progress', { id, progressPct: pct })
  })

  await completeBacktest(id, metrics)
  hub.broadcast('backtest_done', { id, status: 'completed' })
}

// Small helper — runner doesn't know the owner up front, but it's stored on
// the row. Reading it once lets us reuse the user-scoped getter.
async function ownerOf(id: number): Promise<string> {
  const { getPool } = await import('../db.js')
  const pool = getPool()
  const r = await pool.query<{ user_id: string }>(`SELECT user_id FROM backtests WHERE id = $1`, [
    id,
  ])
  if (!r.rows[0]) throw new Error(`backtest ${id} not found`)
  return r.rows[0].user_id
}
