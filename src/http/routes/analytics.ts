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
router.get('/summary', (_req, res) => {
  const stats = getAllTimeStats()
  const portfolioConfig = getAiPortfolioConfig()
  const closed = getClosedAiPositions()
  const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
  const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0).length
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null
  const aiUsage = getAiUsageSummary()
  res.json({
    ...stats, realizedPnl, winRate, closedPositions: closed.length, portfolioConfig,
    aiCostUsd: aiUsage.totalCostUsd,
    aiCallCount: aiUsage.callCount,
  })
})

// GET /api/analytics/ai-cost
router.get('/ai-cost', (_req, res) => {
  const summary = getAiUsageSummary()
  const byDay = getAiUsageByDay(30)
  res.json({ summary, byDay: byDay.reverse() })
})

// GET /api/analytics/intraday?hours=1  (derived from decisions portfolio_json)
router.get('/intraday', (req, res) => {
  const hours = Math.min(48, Math.max(1, parseInt(req.query.hours as string) || 24))
  const data = getIntradayValues(hours)
  res.json({ data, hours })
})

// GET /api/analytics/snapshots?limit=90
router.get('/snapshots', (req, res) => {
  const limit = Math.min(365, Math.max(1, parseInt(req.query.limit as string) || 90))
  const data = getDailyValues(limit)
  res.json({ data })
})

// GET /api/analytics/positions — open + closed AI positions
router.get('/positions', (_req, res) => {
  const open = getOpenAiPositions()
  const closed = getClosedAiPositions()
  res.json({ open, closed })
})

// GET /api/analytics/performance
router.get('/performance', (_req, res) => {
  const closed = getClosedAiPositions()
  const open = getOpenAiPositions()
  const stats = getAllTimeStats()

  const realizedPnl = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0)
  const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0)
  const losses = closed.filter((p) => (p.realizedPnl ?? 0) < 0)
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : null
  const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + (p.realizedPnl ?? 0), 0) / wins.length : null
  const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + (p.realizedPnl ?? 0), 0) / losses.length : null

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
})

export default router
