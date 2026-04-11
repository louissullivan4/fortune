import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getEngine, createEngine } from '../../engine/EngineService.js'
import { getUserApiKeys, getUserConfig } from './users.js'
import { getOrCreateT212Client } from '../../api/trading212.js'
import { isMarketOpen } from '../../engine/scheduler.js'

const router = Router()
router.use(requireAuth)

async function resolveEngine(userId: string) {
  let engine = getEngine(userId)
  if (!engine) {
    const keys = await getUserApiKeys(userId)
    const cfg = await getUserConfig(userId)
    if (!keys?.t212KeyId || !keys?.t212KeySecret) {
      throw new Error('T212 API keys not configured — update them in your profile')
    }
    if (!keys.anthropicApiKey) {
      throw new Error('Anthropic API key not configured — update it in your profile')
    }
    if (!cfg) throw new Error('User config not found')
    const t212 = getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
    engine = createEngine(userId, t212, keys.anthropicApiKey, cfg)
  }
  return engine
}

// GET /api/engine/status
router.get('/status', async (req, res, next) => {
  try {
    const engine = getEngine(req.user!.userId)
    if (!engine) {
      return res.json({
        running: false,
        startedAt: null,
        lastCycleAt: null,
        nextCycleAt: null,
        cycleCount: 0,
        marketOpen: isMarketOpen(),
        mode: 'demo',
        intervalMs: 900000,
        userId: req.user!.userId,
      })
    }
    res.json(engine.status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/start
router.post('/start', async (req, res, next) => {
  try {
    const engine = await resolveEngine(req.user!.userId)
    const status = await engine.start()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/stop
router.post('/stop', (req, res, next) => {
  try {
    const engine = getEngine(req.user!.userId)
    if (!engine) return res.json({ running: false })
    const status = engine.stop()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

// POST /api/engine/cycle
router.post('/cycle', async (req, res, next) => {
  try {
    const engine = await resolveEngine(req.user!.userId)
    const status = await engine.triggerCycle()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

export default router
