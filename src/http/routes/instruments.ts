import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserApiKeys } from './users.js'
import { getOrCreateT212Client } from '../../api/trading212.js'

const router = Router()
router.use(requireAuth)

// GET /api/instruments/search?q=AAPL&exchange=NYSE
router.get('/search', async (req, res, next) => {
  try {
    const q = ((req.query.q as string) ?? '').toLowerCase().trim()
    if (!q) return res.json({ data: [], total: 0 })

    const exchangeFilter = ((req.query.exchange as string) ?? '').toUpperCase() || null

    const userId = req.user!.userId
    const keys = await getUserApiKeys(userId)
    if (!keys?.t212KeyId || !keys?.t212KeySecret) {
      throw new Error('T212 API keys not configured — update them in your profile')
    }

    // Shared singleton client — instrument list is cached in memory after first fetch
    const t212 = getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
    const instruments = await t212.getInstruments()

    const results = [...instruments.values()]
      .filter((i) => (exchangeFilter ? i.exchange === exchangeFilter : true))
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

// GET /api/instruments/resolve?tickers=AAPL,MSFT — bulk lookup by exact ticker
router.get('/resolve', async (req, res, next) => {
  try {
    const raw = (req.query.tickers as string) ?? ''
    const tickers = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tickers.length === 0) return res.json({})

    const userId = req.user!.userId
    const keys = await getUserApiKeys(userId)
    if (!keys?.t212KeyId || !keys?.t212KeySecret) {
      throw new Error('T212 API keys not configured')
    }

    const t212 = getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
    const instruments = await t212.getInstruments()

    const result: Record<string, unknown> = {}
    for (const ticker of tickers) {
      const inst = instruments.get(ticker)
      if (inst) result[ticker] = inst
    }

    res.json(result)
  } catch (err) {
    next(err)
  }
})

export default router
