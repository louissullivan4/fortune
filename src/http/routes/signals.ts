import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getAllHistories } from '../../api/marketdata.js'
import { generateSignals } from '../../strategy/signals.js'
import { getOpenAiPositions } from '../../analytics/journal.js'
import { getCachedSignals, setCachedSignals, isCacheFresh } from '../../cache/signals.js'
import { hub } from '../../ws/hub.js'
import { getUserApiKeys, getUserConfig } from './users.js'
import { getOrCreateT212Client, type Trading212Client } from '../../api/trading212.js'

const router = Router()
router.use(requireAuth)

async function getT212(userId: string): Promise<Trading212Client> {
  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

async function computeSignals(userId: string) {
  const [t212, cfg] = await Promise.all([getT212(userId), getUserConfig(userId)])
  if (!cfg) throw new Error('User config not found')
  const snapshot = await t212.getPortfolioSnapshot()
  const histories = await getAllHistories(cfg.tradeUniverse, 90)
  const botTickers = new Set((await getOpenAiPositions(userId)).map((p) => p.ticker))
  const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
  const signals = generateSignals(cfg.tradeUniverse, histories, botPositions)
  setCachedSignals(userId, signals)
  hub.broadcast('signal_refresh', { computedAt: new Date().toISOString(), count: signals.length })
  return signals
}

// GET /api/signals
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    if (isCacheFresh(userId)) {
      const cache = getCachedSignals(userId)!
      return res.json({ data: cache.data, computedAt: cache.computedAt, cached: true })
    }
    const signals = await computeSignals(userId)
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false })
  } catch (err) {
    next(err)
  }
})

// POST /api/signals/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const signals = await computeSignals(req.user!.userId)
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false })
  } catch (err) {
    next(err)
  }
})

// GET /api/signals/:ticker
router.get('/:ticker', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { ticker } = req.params
    const cache = getCachedSignals(userId)
    if (cache) {
      const signal = cache.data.find((s) => s.ticker === ticker)
      if (signal) return res.json({ data: signal, computedAt: cache.computedAt })
    }
    const t212 = await getT212(userId)
    const histories = await getAllHistories([ticker], 90)
    const snapshot = await t212.getPortfolioSnapshot()
    const botPos = snapshot.positions.filter((p) => p.ticker === ticker)
    const signals = generateSignals([ticker], histories, botPos)
    if (signals.length === 0) return res.status(404).json({ error: `No signal data for ${ticker}` })
    res.json({ data: signals[0], computedAt: new Date().toISOString() })
  } catch (err) {
    next(err)
  }
})

export default router
