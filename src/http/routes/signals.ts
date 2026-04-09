import { Router } from 'express'
import { config } from '../../config/index.js'
import { getAllHistories } from '../../api/marketdata.js'
import { getPortfolioSnapshot } from '../../api/trading212.js'
import { generateSignals } from '../../strategy/signals.js'
import { getOpenAiPositions } from '../../analytics/journal.js'
import { getCachedSignals, setCachedSignals, isCacheFresh } from '../../cache/signals.js'
import { hub } from '../../ws/hub.js'

const router = Router()

async function computeSignals() {
  const snapshot = await getPortfolioSnapshot()
  const histories = await getAllHistories(config.tradeUniverse, 90)
  const botTickers = new Set(getOpenAiPositions().map((p) => p.ticker))
  const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
  const signals = generateSignals(config.tradeUniverse, histories, botPositions)
  setCachedSignals(signals)
  hub.broadcast('signal_refresh', { computedAt: new Date().toISOString(), count: signals.length })
  return signals
}

// GET /api/signals — returns cached signals (fresh if < 5min old)
router.get('/', async (_req, res, next) => {
  try {
    if (isCacheFresh()) {
      const cache = getCachedSignals()!
      return res.json({ data: cache.data, computedAt: cache.computedAt, cached: true })
    }
    const signals = await computeSignals()
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false })
  } catch (err) {
    next(err)
  }
})

// POST /api/signals/refresh — force fresh computation
router.post('/refresh', async (_req, res, next) => {
  try {
    const signals = await computeSignals()
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false })
  } catch (err) {
    next(err)
  }
})

// GET /api/signals/:ticker
router.get('/:ticker', async (req, res, next) => {
  try {
    const { ticker } = req.params
    const cache = getCachedSignals()
    if (cache) {
      const signal = cache.data.find((s) => s.ticker === ticker)
      if (signal) return res.json({ data: signal, computedAt: cache.computedAt })
    }
    // Not in cache — fetch just this ticker
    const histories = await getAllHistories([ticker], 90)
    const snapshot = await getPortfolioSnapshot()
    const botPos = snapshot.positions.filter((p) => p.ticker === ticker)
    const signals = generateSignals([ticker], histories, botPos)
    if (signals.length === 0) return res.status(404).json({ error: `No signal data for ${ticker}` })
    res.json({ data: signals[0], computedAt: new Date().toISOString() })
  } catch (err) {
    next(err)
  }
})

export default router
