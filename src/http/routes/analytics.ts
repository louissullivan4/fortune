import { Router } from 'express'
import {
  getAllTimeStats,
  getDailyValues,
  getIntradayValues,
  getOpenAiPositions,
  getClosedAiPositions,
  getAiPortfolioConfig,
  getAiUsageSummary,
  getAiUsageByDay,
} from '../../analytics/journal.js'

const router = Router()

// GET /api/analytics/summary
router.get('/summary', async (_req, res, next) => {
  try {
    const [stats, portfolioConfig, closed, aiUsage] = await Promise.all([
      getAllTimeStats(),
      getAiPortfolioConfig(),
      getClosedAiPositions(),
      getAiUsageSummary(),
    ])
    const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
    const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0).length
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null
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
router.get('/ai-cost', async (_req, res, next) => {
  try {
    const [summary, byDay] = await Promise.all([getAiUsageSummary(), getAiUsageByDay(30)])
    res.json({ summary, byDay: byDay.reverse() })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/intraday?hours=1
router.get('/intraday', async (req, res, next) => {
  try {
    const hours = Math.min(48, Math.max(1, parseInt(req.query.hours as string) || 24))
    const data = await getIntradayValues(hours)
    res.json({ data, hours })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/snapshots?limit=90
router.get('/snapshots', async (req, res, next) => {
  try {
    const limit = Math.min(365, Math.max(1, parseInt(req.query.limit as string) || 90))
    const data = await getDailyValues(limit)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/positions
router.get('/positions', async (_req, res, next) => {
  try {
    const [open, closed] = await Promise.all([getOpenAiPositions(), getClosedAiPositions()])
    res.json({ open, closed })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/performance
router.get('/performance', async (_req, res, next) => {
  try {
    const [closed, open, stats] = await Promise.all([
      getClosedAiPositions(),
      getOpenAiPositions(),
      getAllTimeStats(),
    ])
    const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
    const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0)
    const losses = closed.filter((p) => (p.realizedPnl ?? 0) < 0)
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : null
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

export default router
