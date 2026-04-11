import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getEngine } from '../../engine/EngineService.js'
import { getUserApiKeys } from './users.js'
import { Trading212Client } from '../../api/trading212.js'

const router = Router()
router.use(requireAuth)

async function getT212(userId: string): Promise<Trading212Client> {
  const engine = getEngine(userId)
  if (engine) return engine.t212
  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return new Trading212Client(keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

// GET /api/instruments/search?q=AAPL
router.get('/search', async (req, res, next) => {
  try {
    const q = ((req.query.q as string) ?? '').toLowerCase().trim()
    const t212 = await getT212(req.user!.userId)
    const instruments = await t212.getInstruments()
    const results = [...instruments.values()]
      .filter(
        (i) =>
          i.ticker.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          i.shortName?.toLowerCase().includes(q)
      )
      .slice(0, 50)
    res.json({ data: results, total: results.length })
  } catch (err) {
    next(err)
  }
})

export default router
