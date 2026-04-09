import { Router } from 'express'
import { getInstruments } from '../../api/trading212.js'

const router = Router()

// GET /api/instruments/search?q=AAPL
router.get('/search', async (req, res, next) => {
  try {
    const q = ((req.query.q as string) ?? '').toLowerCase().trim()
    const instruments = await getInstruments()
    const results = [...instruments.values()]
      .filter((i) =>
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
