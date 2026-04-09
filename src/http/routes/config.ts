import { Router } from 'express'
import { config, updateConfig } from '../../config/index.js'

const router = Router()

function configResponse() {
  return {
    tradeUniverse:    config.tradeUniverse,
    tradeIntervalMs:  config.tradeIntervalMs,
    tradeIntervalS:   config.tradeIntervalMs / 1000,
    maxBudgetEur:     config.maxBudgetEur,
    maxPositionPct:   config.maxPositionPct,
    dailyLossLimitPct: config.dailyLossLimitPct,
    stopLossPct:      config.stopLossPct,
    takeProfitPct:    config.takeProfitPct,
    trading212Mode:   config.trading212Mode,
  }
}

// GET /api/config
router.get('/', (_req, res) => {
  res.json(configResponse())
})

// PUT /api/config
router.put('/', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>
    const updates: Record<string, unknown> = {}

    if (Array.isArray(body.tradeUniverse)) updates.tradeUniverse = body.tradeUniverse.map(String)
    if (typeof body.tradeIntervalMs === 'number' && body.tradeIntervalMs >= 10_000) {
      updates.tradeIntervalMs = body.tradeIntervalMs
    }
    if (typeof body.maxBudgetEur === 'number' && body.maxBudgetEur > 0) updates.maxBudgetEur = body.maxBudgetEur
    if (typeof body.maxPositionPct === 'number' && body.maxPositionPct > 0 && body.maxPositionPct <= 1) updates.maxPositionPct = body.maxPositionPct
    if (typeof body.dailyLossLimitPct === 'number' && body.dailyLossLimitPct > 0 && body.dailyLossLimitPct <= 1) updates.dailyLossLimitPct = body.dailyLossLimitPct
    if (typeof body.stopLossPct === 'number' && body.stopLossPct > 0 && body.stopLossPct <= 1) updates.stopLossPct = body.stopLossPct
    if (typeof body.takeProfitPct === 'number' && body.takeProfitPct > 0 && body.takeProfitPct <= 1) updates.takeProfitPct = body.takeProfitPct

    await updateConfig(updates as Parameters<typeof updateConfig>[0])
    res.json(configResponse())
  } catch (err) {
    next(err)
  }
})

export default router
