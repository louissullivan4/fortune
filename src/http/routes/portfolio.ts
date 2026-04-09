import { Router } from 'express'
import { getPortfolioSnapshot } from '../../api/trading212.js'
import { getOpenAiPositions } from '../../analytics/journal.js'
import { hub } from '../../ws/hub.js'

const router = Router()

// GET /api/portfolio
router.get('/', async (_req, res, next) => {
  try {
    const [snapshot, aiPositions] = await Promise.all([
      getPortfolioSnapshot(),
      getOpenAiPositions(),
    ])
    hub.broadcast('portfolio_update', { totalValue: snapshot.totalValue })
    res.json({ ...snapshot, aiPositions })
  } catch (err) {
    next(err)
  }
})

export default router
