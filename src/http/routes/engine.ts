import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getEngine, createEngine, type EngineStatus } from '../../engine/EngineService.js'
import { getUserApiKeys, getUserMarketConfig, listUserMarkets } from './users.js'
import { getOrCreateT212Client } from '../../api/trading212.js'
import { isMarketOpenSpec } from '../../engine/scheduler.js'
import { getMarketSpec, MARKET_CODES } from '../../markets/registry.js'

const router = Router()
router.use(requireAuth)

function validateMarket(market: string, res: import('express').Response): boolean {
  if (!MARKET_CODES.includes(market)) {
    res.status(400).json({ error: `Unknown market: ${market}` })
    return false
  }
  return true
}

async function resolveEngine(userId: string, market: string) {
  let engine = getEngine(userId, market)
  if (!engine) {
    const keys = await getUserApiKeys(userId)
    const cfg = await getUserMarketConfig(userId, market)
    if (!keys?.t212KeyId || !keys?.t212KeySecret) {
      throw new Error('T212 API keys not configured — update them in your profile')
    }
    if (!keys.anthropicApiKey) {
      throw new Error('Anthropic API key not configured — update it in your profile')
    }
    if (!cfg) {
      throw new Error(`Market ${market} is not enabled for this user`)
    }
    const t212 = getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
    const spec = getMarketSpec(market)
    engine = createEngine(userId, spec, t212, keys.anthropicApiKey, cfg)
  }
  return engine
}

function defaultStatus(userId: string, market: string): EngineStatus {
  const spec = getMarketSpec(market)
  return {
    running: false,
    startedAt: null,
    lastCycleAt: null,
    nextCycleAt: null,
    cycleCount: 0,
    marketOpen: isMarketOpenSpec(spec),
    mode: 'demo',
    intervalMs: 900_000,
    userId,
    market,
    pendingSettlement: 0,
  }
}

// GET /api/engine/status — array of statuses for every enabled market
router.get('/status', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const userMarkets = await listUserMarkets(userId)
    const enabledMarkets = userMarkets.filter((m) => m.enabled).map((m) => m.code)
    const statuses: EngineStatus[] = []
    for (const market of enabledMarkets) {
      const engine = getEngine(userId, market)
      statuses.push(engine ? engine.status : defaultStatus(userId, market))
    }
    // Backwards-compat: if no enabled markets, return one NYSE entry.
    if (statuses.length === 0) statuses.push(defaultStatus(userId, 'NYSE'))
    res.json({ statuses })
  } catch (err) {
    next(err)
  }
})

// GET /api/engine/:market/status — status for one market
router.get('/:market/status', async (req, res, next) => {
  try {
    const market = req.params.market
    if (!validateMarket(market, res)) return
    const userId = req.user!.userId
    const engine = getEngine(userId, market)
    res.json(engine ? engine.status : defaultStatus(userId, market))
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/:market/start
router.post('/:market/start', async (req, res, next) => {
  try {
    const market = req.params.market
    if (!validateMarket(market, res)) return
    const engine = await resolveEngine(req.user!.userId, market)
    const status = await engine.start()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/:market/stop
router.post('/:market/stop', (req, res, next) => {
  try {
    const market = req.params.market
    if (!validateMarket(market, res)) return
    const engine = getEngine(req.user!.userId, market)
    if (!engine) return res.json({ running: false })
    const status = engine.stop()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/:market/cycle
router.post('/:market/cycle', async (req, res, next) => {
  try {
    const market = req.params.market
    if (!validateMarket(market, res)) return
    const engine = await resolveEngine(req.user!.userId, market)
    const status = await engine.triggerCycle()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// Backwards-compat: legacy /start /stop /cycle without market — default NYSE
router.post('/start', async (req, res, next) => {
  try {
    const engine = await resolveEngine(req.user!.userId, 'NYSE')
    const status = await engine.start()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

router.post('/stop', (req, res, next) => {
  try {
    const engine = getEngine(req.user!.userId, 'NYSE')
    if (!engine) return res.json({ running: false })
    const status = engine.stop()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

router.post('/cycle', async (req, res, next) => {
  try {
    const engine = await resolveEngine(req.user!.userId, 'NYSE')
    const status = await engine.triggerCycle()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

export default router
