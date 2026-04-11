import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getEngine } from '../../engine/EngineService.js'
import { getUserApiKeys } from './users.js'
import { Trading212Client } from '../../api/trading212.js'
import { getOpenAiPositions } from '../../analytics/journal.js'
import { hub } from '../../ws/hub.js'

const router = Router()
router.use(requireAuth)

async function getT212(userId: string): Promise<Trading212Client> {
  // Prefer the engine's client if running (has instrument cache warm)
  const engine = getEngine(userId)
  if (engine) return engine.t212

  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return new Trading212Client(keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

// GET /api/portfolio
router.get('/', async (req, res, next) => {
  try {
    const t212 = await getT212(req.user!.userId)
    const [snapshot, aiPositions] = await Promise.all([
      t212.getPortfolioSnapshot(),
      getOpenAiPositions(req.user!.userId),
    ])
    hub.broadcast('portfolio_update', { totalValue: snapshot.totalValue })
    res.json({ ...snapshot, aiPositions })
  } catch (err) {
    next(err)
  }
})

export default router
