import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserConfig, applyConfigUpdate } from './users.js'
import { getEngine } from '../../engine/EngineService.js'
import { defaultWindow, EXCHANGE_CODES, type ExchangeCode } from '../../engine/markets.js'

const router = Router()
router.use(requireAuth)

async function pushCfgToEngine(userId: string) {
  const engine = getEngine(userId)
  if (engine) {
    const cfg = await getUserConfig(userId)
    if (cfg) engine.updateConfig(cfg)
  }
}

// GET /api/config
router.get('/', async (req, res, next) => {
  try {
    const cfg = await getUserConfig(req.user!.userId)
    if (!cfg) return res.status(404).json({ error: 'Config not found' })
    res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// GET /api/config/markets/suggest-hours?exchange=XETR
router.get('/markets/suggest-hours', (req, res) => {
  const exchange = String(req.query.exchange ?? '') as ExchangeCode
  if (!EXCHANGE_CODES.includes(exchange)) {
    return res.status(400).json({ error: `Unknown exchange ${exchange}` })
  }
  res.json({ exchange, ...defaultWindow(exchange) })
})

// PUT /api/config — partial update of global + any markets + universe
router.put('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    await applyConfigUpdate(userId, req.body as Record<string, unknown>)
    await pushCfgToEngine(userId)
    const cfg = await getUserConfig(userId)
    res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// PUT /api/config/markets/:exchange — patch one market's config
router.put('/markets/:exchange', async (req, res, next) => {
  try {
    const exchange = req.params.exchange as ExchangeCode
    if (!EXCHANGE_CODES.includes(exchange)) {
      return res.status(400).json({ error: `Unknown exchange ${exchange}` })
    }
    const body = req.body as Record<string, unknown>
    // Enforce that this endpoint only touches the named market, no matter
    // what body.exchange says.
    const marketPatch = { ...body, exchange }
    await applyConfigUpdate(req.user!.userId, { markets: [marketPatch] })
    await pushCfgToEngine(req.user!.userId)
    const cfg = await getUserConfig(req.user!.userId)
    res.json(cfg)
  } catch (err) {
    next(err)
  }
})

export default router
