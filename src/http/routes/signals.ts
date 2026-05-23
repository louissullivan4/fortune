import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getAllHistories } from '../../api/marketdata.js'
import { generateSignals } from '../../strategy/signals.js'
import { getOpenAiPositions } from '../../analytics/journal.js'
import { getCachedSignals, setCachedSignals, isCacheFresh } from '../../cache/signals.js'
import { hub } from '../../ws/hub.js'
import { getUserApiKeys, getUserMarketConfig } from './users.js'
import { getOrCreateT212Client, type Trading212Client } from '../../api/trading212.js'
import { MARKET_CODES } from '../../markets/registry.js'

const router = Router()
router.use(requireAuth)

function resolveMarket(req: import('express').Request): string {
  const m = (req.query.market as string | undefined) ?? 'NYSE'
  if (!MARKET_CODES.includes(m)) {
    throw Object.assign(new Error(`Unknown market: ${m}`), { status: 400 })
  }
  return m
}

async function getT212(userId: string): Promise<Trading212Client> {
  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

async function computeSignals(userId: string, market: string) {
  const [t212, cfg] = await Promise.all([getT212(userId), getUserMarketConfig(userId, market)])
  if (!cfg) throw new Error(`User config not found for market ${market}`)
  const snapshot = await t212.getPortfolioSnapshot()
  const histories = await getAllHistories(cfg.tradeUniverse, 90)
  const botTickers = new Set((await getOpenAiPositions(userId, market)).map((p) => p.ticker))
  const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
  const signals = generateSignals(cfg.tradeUniverse, histories, botPositions)
  setCachedSignals(`${userId}::${market}`, signals)
  hub.broadcast('signal_refresh', {
    computedAt: new Date().toISOString(),
    count: signals.length,
    market,
  })
  return signals
}

// GET /api/signals?market=NYSE
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const market = resolveMarket(req)
    const cacheKey = `${userId}::${market}`
    if (isCacheFresh(cacheKey)) {
      const cache = getCachedSignals(cacheKey)!
      return res.json({ data: cache.data, computedAt: cache.computedAt, cached: true, market })
    }
    const signals = await computeSignals(userId, market)
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false, market })
  } catch (err) {
    next(err)
  }
})

// POST /api/signals/refresh?market=NYSE
router.post('/refresh', async (req, res, next) => {
  try {
    const market = resolveMarket(req)
    const signals = await computeSignals(req.user!.userId, market)
    res.json({ data: signals, computedAt: new Date().toISOString(), cached: false, market })
  } catch (err) {
    next(err)
  }
})

// GET /api/signals/:ticker?market=NYSE
router.get('/:ticker', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const market = resolveMarket(req)
    const { ticker } = req.params
    const cacheKey = `${userId}::${market}`
    const cache = getCachedSignals(cacheKey)
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
