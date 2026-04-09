import { Router } from 'express'
import { getOrdersPaginated } from '../../analytics/journal.js'

const router = Router()

// GET /api/orders?page=1&limit=20
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
  const { data, total } = getOrdersPaginated(page, limit)
  res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
})

export default router
