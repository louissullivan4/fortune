import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getOrdersPaginated } from '../../analytics/journal.js'
import { MARKET_CODES } from '../../markets/registry.js'

const router = Router()
router.use(requireAuth)

// GET /api/orders?page=1&limit=20&market=NYSE
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const market = req.query.market as string | undefined
    if (market !== undefined && !MARKET_CODES.includes(market)) {
      return res.status(400).json({ error: `Unknown market: ${market}` })
    }
    const { data, total } = await getOrdersPaginated(req.user!.userId, page, limit, market)
    res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

export default router
