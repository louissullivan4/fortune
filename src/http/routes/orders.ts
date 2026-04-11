import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getOrdersPaginated } from '../../analytics/journal.js'

const router = Router()
router.use(requireAuth)

// GET /api/orders?page=1&limit=20
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const { data, total } = await getOrdersPaginated(req.user!.userId, page, limit)
    res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

export default router
