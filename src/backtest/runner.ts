import { getAllHistoriesRange } from '../api/marketdata.js'
import { hub } from '../ws/hub.js'
import { runBacktest, currencyOf } from './simulator.js'
import { buildFxResolver } from './fx-history.js'
import {
  getBacktest,
  updateBacktestProgress,
  completeBacktest,
  failBacktest,
  createBacktestVariant,
} from './journal.js'
import type { BacktestConfig } from './types.js'

// Single in-process queue. Backtests are CPU-bound but short — running one at
// a time per server keeps memory predictable and avoids contention.
interface QueueItem {
  id: number
  variantBConfig?: BacktestConfig
}

const queue: QueueItem[] = []
let busy = false

export function enqueueBacktest(id: number, variantBConfig?: BacktestConfig): void {
  queue.push({ id, variantBConfig })
  void drain()
}

async function drain(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (queue.length > 0) {
      const item = queue.shift()!
      try {
        await execute(item.id, item.variantBConfig)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[backtest] runner failed for id=${item.id}: ${msg}`)
        try {
          await failBacktest(item.id, msg)
        } catch {
          /* already logged */
        }
        hub.broadcast('backtest_done', { id: item.id, status: 'failed', error: msg })
      }
    }
  } finally {
    busy = false
  }
}

async function execute(id: number, variantBConfig?: BacktestConfig): Promise<void> {
  const userId = await ownerOf(id)
  const row = await getBacktest(id, userId)
  if (!row) throw new Error(`backtest ${id} not found`)
  const config = row.configJson

  const start = new Date(config.startDate + 'T00:00:00Z')
  const end = new Date(config.endDate + 'T23:59:59Z')
  const warmup = new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000)

  await updateBacktestProgress(id, 0)
  hub.broadcast('backtest_progress', { id, progressPct: 0 })

  // Fetch historical data once — shared by both variants
  const allTickers = new Set([...config.tradeUniverse, ...(variantBConfig?.tradeUniverse ?? [])])
  const histories = await getAllHistoriesRange([...allTickers], warmup, end, '1h')

  const totalBars = [...histories.values()].reduce((s, h) => s + h.bars.length, 0)
  if (totalBars === 0) {
    throw new Error(
      `No market data returned for any ticker in [${[...allTickers].join(', ')}] over ${config.startDate}..${config.endDate}. Yahoo hourly history is limited to ~730 days.`
    )
  }

  // Historical EUR-per-currency rates so non-EUR tickers size/cap like live.
  const fxRateAt = await buildFxResolver([...allTickers].map(currencyOf), warmup, end)

  let lastReportedPct = 0
  const metrics = await runBacktest(
    config,
    histories,
    (pct) => {
      if (pct === lastReportedPct) return
      lastReportedPct = pct
      void updateBacktestProgress(id, pct).catch(() => {})
      hub.broadcast('backtest_progress', { id, progressPct: pct })
    },
    fxRateAt
  )

  await completeBacktest(id, metrics)
  hub.broadcast('backtest_done', { id, status: 'completed' })

  // Run variant B on the same data if provided
  if (variantBConfig) {
    const variantRow = await createBacktestVariant(userId, variantBConfig, id)
    await updateBacktestProgress(variantRow.id, 0)
    hub.broadcast('backtest_progress', { id: variantRow.id, progressPct: 0 })

    const variantMetrics = await runBacktest(
      variantBConfig,
      histories,
      (pct) => {
        void updateBacktestProgress(variantRow.id, pct).catch(() => {})
        hub.broadcast('backtest_progress', { id: variantRow.id, progressPct: pct })
      },
      fxRateAt
    )

    await completeBacktest(variantRow.id, variantMetrics)
    hub.broadcast('backtest_done', { id: variantRow.id, status: 'completed' })
  }
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
