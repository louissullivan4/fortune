import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserApiKeys } from './users.js'
import { getOrCreateT212Client, type Trading212Client } from '../../api/trading212.js'
import { getOpenAiPositions, closeAllAiPositions } from '../../analytics/journal.js'
import { hub } from '../../ws/hub.js'

const router = Router()
router.use(requireAuth)

async function getT212(userId: string): Promise<Trading212Client> {
  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

// GET /api/portfolio
router.get('/', async (req, res, next) => {
  try {
    const t212 = await getT212(req.user!.userId)
    const [snapshot, openAiPositions] = await Promise.all([
      t212.getPortfolioSnapshot(),
      getOpenAiPositions(req.user!.userId),
    ])

    const brokerTickers = new Set(snapshot.positions.map((p) => p.ticker))
    const soldPositions = openAiPositions.filter((p) => !brokerTickers.has(p.ticker))
    const now = new Date().toISOString()

    if (soldPositions.length > 0) {
      const orderHistory = await t212.getOrderHistory()
      const soldTickers = new Set(soldPositions.map((p) => p.ticker))
      const exitPriceByTicker = new Map<string, number | null>()

      for (const ticker of soldTickers) {
        const fillPrice =
          orderHistory
            .filter((o) => o.ticker === ticker && o.quantity < 0 && o.filledPrice != null)
            .sort((a, b) => new Date(b.dateModified).getTime() - new Date(a.dateModified).getTime())
            .at(0)?.filledPrice ?? null
        exitPriceByTicker.set(ticker, fillPrice)
      }

      await Promise.all(
        soldPositions.map((p) =>
          closeAllAiPositions(
            p.ticker,
            exitPriceByTicker.get(p.ticker) ?? null,
            now,
            req.user!.userId
          )
        )
      )
    }

    const aiPositions = openAiPositions.filter((p) => brokerTickers.has(p.ticker))
    const botTickers = new Set(aiPositions.map((p) => p.ticker))
    const manualPositions = snapshot.positions.filter((p) => !botTickers.has(p.ticker))

    hub.broadcast('portfolio_update', { totalValue: snapshot.totalValue })
    res.json({ ...snapshot, aiPositions, manualPositions })
  } catch (err) {
    next(err)
  }
})

export default router
