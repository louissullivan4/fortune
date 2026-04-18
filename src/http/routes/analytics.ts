import { Router } from 'express'
import { requireAuth, requireAdminOrAccountant } from '../middleware/auth.js'
import {
  getAllTimeStats,
  getDailyValues,
  getDailyStatsRange,
  getIntradayValues,
  getOpenAiPositions,
  getClosedAiPositions,
  getClosedAiPositionsWithOrders,
  getAiPositionDetails,
  getAiPortfolioConfig,
  getAiUsageSummary,
  getAiUsageByDay,
} from '../../analytics/journal.js'
import { getUserApiKeys } from './users.js'
import { getOrCreateT212Client } from '../../api/trading212.js'
import { generateReport, validateReportRange } from '../../analytics/report.js'
import { getPool } from '../../db.js'

const router = Router()
router.use(requireAuth)

// GET /api/analytics/summary
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const [stats, portfolioConfig, closed, aiUsage] = await Promise.all([
      getAllTimeStats(userId),
      getAiPortfolioConfig(userId),
      getClosedAiPositions(userId),
      getAiUsageSummary(userId),
    ])
    const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
    const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0).length
    const lossCount = closed.filter((p) => (p.realizedPnl ?? 0) < 0).length
    const decidedTrades = wins + lossCount
    const winRate = decidedTrades > 0 ? (wins / decidedTrades) * 100 : null
    res.json({
      ...stats,
      realizedPnl,
      winRate,
      closedPositions: closed.length,
      portfolioConfig,
      aiCostUsd: aiUsage.totalCostUsd,
      aiCallCount: aiUsage.callCount,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/ai-cost
router.get('/ai-cost', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const [summary, byDay] = await Promise.all([
      getAiUsageSummary(userId),
      getAiUsageByDay(userId, 365),
    ])
    res.json({ summary, byDay: byDay.reverse() })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/daily-stats?limit=365
router.get('/daily-stats', async (req, res, next) => {
  try {
    const limit = Math.min(365, Math.max(1, parseInt(req.query.limit as string) || 365))
    const data = await getDailyStatsRange(req.user!.userId, limit)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/intraday?hours=1
router.get('/intraday', async (req, res, next) => {
  try {
    const hours = Math.min(48, Math.max(1, parseInt(req.query.hours as string) || 24))
    const data = await getIntradayValues(req.user!.userId, hours)
    res.json({ data, hours })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/snapshots?limit=90
router.get('/snapshots', async (req, res, next) => {
  try {
    const limit = Math.min(365, Math.max(1, parseInt(req.query.limit as string) || 90))
    const data = await getDailyValues(req.user!.userId, limit)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/positions
router.get('/positions', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const [open, closed] = await Promise.all([
      getOpenAiPositions(userId),
      getClosedAiPositions(userId),
    ])
    res.json({ open, closed })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/performance
router.get('/performance', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const [closed, open, stats] = await Promise.all([
      getClosedAiPositions(userId),
      getOpenAiPositions(userId),
      getAllTimeStats(userId),
    ])
    const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
    const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0)
    const losses = closed.filter((p) => (p.realizedPnl ?? 0) < 0)
    const decidedTrades = wins.length + losses.length
    const winRate = decidedTrades > 0 ? (wins.length / decidedTrades) * 100 : null
    const avgWin =
      wins.length > 0 ? wins.reduce((s, p) => s + (p.realizedPnl ?? 0), 0) / wins.length : null
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, p) => s + (p.realizedPnl ?? 0), 0) / losses.length
        : null
    res.json({
      ...stats,
      realizedPnl,
      winRate,
      avgWin,
      avgLoss,
      wins: wins.length,
      losses: losses.length,
      openPositions: open.length,
      closedPositions: closed.length,
    })
  } catch (err) {
    next(err)
  }
})

// T212 charges 0.15% FX conversion on both the buy and sell legs for any position
// traded in a foreign currency (i.e. USD-denominated stocks from a EUR account).
// Tickers matching _US_ are USD stocks; all others are assumed EUR-denominated.
const T212_FX_FEE_RATE = 0.0015

function isUsdTicker(ticker: string): boolean {
  return ticker.includes('_US_')
}

function estimateFxCost(
  entryPrice: number | null,
  exitPrice: number | null,
  quantity: number,
  ticker: string
): number {
  if (!isUsdTicker(ticker)) return 0
  const buyValue = (entryPrice ?? 0) * quantity
  const sellValue = (exitPrice ?? 0) * quantity
  return (buyValue + sellValue) * T212_FX_FEE_RATE
}

// GET /api/analytics/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns AI-only closed positions enriched with T212 actual fill prices where
// available, FX cost estimates, and net P&L. Excludes personal portfolio positions.
router.get('/pnl', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const from = req.query.from as string | undefined
    const to = req.query.to as string | undefined

    const positions = await getClosedAiPositionsWithOrders(userId, from, to)

    const t212FillMap = new Map<string, number>()
    try {
      const keys = await getUserApiKeys(userId)
      if (keys?.t212KeyId && keys?.t212KeySecret) {
        const t212 = getOrCreateT212Client(
          userId,
          keys.t212KeyId,
          keys.t212KeySecret,
          keys.t212Mode
        )
        const history = await t212.getOrderHistory()
        for (const order of history) {
          if (order.filledPrice != null) {
            t212FillMap.set(order.id, order.filledPrice)
          }
        }
      }
    } catch {
      // T212 unavailable — proceed with estimated prices only
    }

    const enriched = positions.map((p) => {
      const actualEntry =
        (p.buyT212OrderId ? t212FillMap.get(p.buyT212OrderId) : undefined) ?? p.entryPrice
      const actualExit =
        (p.sellT212OrderId ? t212FillMap.get(p.sellT212OrderId) : undefined) ?? p.exitPrice

      const grossPnl =
        actualEntry != null && actualExit != null
          ? Number(((actualExit - actualEntry) * p.quantity).toFixed(4))
          : p.realizedPnl

      const fxCost = Number(
        estimateFxCost(actualEntry, actualExit, p.quantity, p.ticker).toFixed(4)
      )
      const netPnl = grossPnl != null ? Number((grossPnl - fxCost).toFixed(4)) : null

      return {
        id: p.id,
        ticker: p.ticker,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
        quantity: p.quantity,
        entryPrice: actualEntry,
        exitPrice: actualExit,
        grossPnl,
        fxCost,
        netPnl,
        hasActualFill:
          (p.buyT212OrderId != null && t212FillMap.has(p.buyT212OrderId)) ||
          (p.sellT212OrderId != null && t212FillMap.has(p.sellT212OrderId)),
      }
    })

    const byDayGross = new Map<string, number>()
    const byDayNet = new Map<string, number>()
    for (const p of enriched) {
      if (!p.closedAt) continue
      const day = p.closedAt.slice(0, 10)
      if (p.grossPnl != null) byDayGross.set(day, (byDayGross.get(day) ?? 0) + p.grossPnl)
      if (p.netPnl != null) byDayNet.set(day, (byDayNet.get(day) ?? 0) + p.netPnl)
    }
    const allDays = Array.from(new Set([...byDayGross.keys(), ...byDayNet.keys()])).sort()
    const byDay = allDays.map((date) => ({
      date,
      grossPnl: Number((byDayGross.get(date) ?? 0).toFixed(4)),
      netPnl: Number((byDayNet.get(date) ?? 0).toFixed(4)),
    }))

    const totalGross = enriched.reduce((s, p) => s + (p.grossPnl ?? 0), 0)
    const totalFxCost = enriched.reduce((s, p) => s + p.fxCost, 0)
    const totalNet = enriched.reduce((s, p) => s + (p.netPnl ?? 0), 0)
    const wins = enriched.filter((p) => (p.netPnl ?? 0) > 0)
    const losses = enriched.filter((p) => (p.netPnl ?? 0) < 0)
    const decided = wins.length + losses.length

    res.json({
      positions: enriched,
      byDay,
      summary: {
        totalGrossPnl: Number(totalGross.toFixed(4)),
        totalFxCost: Number(totalFxCost.toFixed(4)),
        totalNetPnl: Number(totalNet.toFixed(4)),
        wins: wins.length,
        losses: losses.length,
        winRate: decided > 0 ? (wins.length / decided) * 100 : null,
        totalTrades: enriched.length,
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/positions/:id/details
router.get('/positions/:id/details', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid position id' })
    const raw = await getAiPositionDetails(id, req.user!.userId)
    if (!raw) return res.status(404).json({ error: 'Position not found' })

    const parseSignals = (json: string) => {
      try {
        return JSON.parse(json) as Array<{ ticker: string; signal: string; reasons: string[] }>
      } catch {
        return []
      }
    }

    res.json({
      buyDecision: raw.buyDecision
        ? {
            timestamp: raw.buyDecision.timestamp,
            reasoning: raw.buyDecision.reasoning,
            signals: parseSignals(raw.buyDecision.signalsJson),
            orderStatus: raw.buyDecision.orderStatus,
          }
        : null,
      sellDecision: raw.sellDecision
        ? {
            timestamp: raw.sellDecision.timestamp,
            reasoning: raw.sellDecision.reasoning,
            signals: parseSignals(raw.sellDecision.signalsJson),
            orderStatus: raw.sellDecision.orderStatus,
          }
        : null,
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/report-users — list users for report picker (admin/accountant)
router.get('/report-users', requireAdminOrAccountant, async (_req, res, next) => {
  try {
    const pool = getPool()
    const result = await pool.query<{
      user_id: string
      email: string
      username: string
      first_name: string
      last_name: string
    }>(
      `SELECT user_id, email, username, first_name, last_name
       FROM users
       WHERE is_active = true
       ORDER BY email`
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
})

// POST /api/analytics/report — generate Excel performance report
router.post('/report', async (req, res, next) => {
  try {
    const {
      userId: requestedUserId,
      from,
      to,
    } = req.body as {
      userId?: string
      from: string
      to: string
    }

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' })
    }

    const validationError = validateReportRange(from, to)
    if (validationError) {
      return res.status(400).json(validationError)
    }

    const role = req.user!.role
    let targetUserId = req.user!.userId
    let userLabel = req.user!.email

    if (requestedUserId && requestedUserId !== req.user!.userId) {
      if (role !== 'admin' && role !== 'accountant') {
        return res
          .status(403)
          .json({ error: 'Only admins and accountants can generate reports for other users' })
      }
      const pool = getPool()
      const result = await pool.query<{ user_id: string; email: string }>(
        'SELECT user_id, email FROM users WHERE user_id = $1',
        [requestedUserId]
      )
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'User not found' })
      }
      targetUserId = result.rows[0].user_id
      userLabel = result.rows[0].email
    }

    const buffer = await generateReport({ userId: targetUserId, from, to }, userLabel)
    const filename = `report-${userLabel.replace(/[@.]/g, '_')}-${from}-to-${to}.xlsx`

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

export default router
