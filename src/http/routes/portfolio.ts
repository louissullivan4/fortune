import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserApiKeys } from './users.js'
import { getOrCreateT212Client, type Trading212Client } from '../../api/trading212.js'
import { getOpenAiPositions, closeAllAiPositions } from '../../analytics/journal.js'
import { hub } from '../../ws/hub.js'
import { MARKET_CODES } from '../../markets/registry.js'

const router = Router()
router.use(requireAuth)

async function getT212(userId: string): Promise<Trading212Client> {
  const keys = await getUserApiKeys(userId)
  if (!keys?.t212KeyId || !keys?.t212KeySecret) {
    throw new Error('T212 API keys not configured — update them in your profile')
  }
  return getOrCreateT212Client(userId, keys.t212KeyId, keys.t212KeySecret, keys.t212Mode)
}

// GET /api/portfolio?market=NYSE  (omit market for all markets)
router.get('/', async (req, res, next) => {
  try {
    const market = req.query.market as string | undefined
    if (market !== undefined && !MARKET_CODES.includes(market)) {
      return res.status(400).json({ error: `Unknown market: ${market}` })
    }
    const userId = req.user!.userId
    const t212 = await getT212(userId)
    const [snapshot, openAiPositions] = await Promise.all([
      t212.getPortfolioSnapshot(),
      getOpenAiPositions(userId, market),
    ])

    const brokerTickers = new Set(snapshot.positions.map((p) => p.ticker))
    const soldPositions = openAiPositions.filter((p) => !brokerTickers.has(p.ticker))
    const now = new Date().toISOString()

    if (soldPositions.length > 0) {
      const orderHistory = await t212.getOrderHistory()
      const exitPriceByTicker = new Map<string, number | null>()

      for (const p of soldPositions) {
        const fillPrice =
          orderHistory
            .filter((o) => o.ticker === p.ticker && o.quantity < 0 && o.filledPrice != null)
            .sort((a, b) => new Date(b.dateModified).getTime() - new Date(a.dateModified).getTime())
            .at(0)?.filledPrice ?? null
        exitPriceByTicker.set(p.ticker, fillPrice)
      }

      // Each orphaned position knows its own market — close per (ticker, market)
      await Promise.all(
        soldPositions.map((p) =>
          closeAllAiPositions(
            p.ticker,
            exitPriceByTicker.get(p.ticker) ?? null,
            now,
            userId,
            p.market
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
