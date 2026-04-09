import { Router } from 'express'
import { config, updateConfig } from '../../config/index.js'

const router = Router()

function configResponse() {
  return {
    tradeUniverse: config.tradeUniverse,
    tradeIntervalMs: config.tradeIntervalMs,
    tradeIntervalS: config.tradeIntervalMs / 1000,
    maxBudgetEur: config.maxBudgetEur,
    maxPositionPct: config.maxPositionPct,
    dailyLossLimitPct: config.dailyLossLimitPct,
    trading212Mode: config.trading212Mode,
    dbPath: config.dbPath,
  }
}

// GET /api/config — return runtime config (no secrets)
router.get('/', (_req, res) => {
  res.json(configResponse())
})

// PUT /api/config — update runtime config
router.put('/', (req, res) => {
  const body = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  if (Array.isArray(body.tradeUniverse)) updates.tradeUniverse = body.tradeUniverse.map(String)
  // tradeIntervalS is a read-only derived field in GET responses — ignore it on PUT.
  // The UI always converts seconds → ms and sets tradeIntervalMs before saving.
  if (typeof body.tradeIntervalMs === 'number' && body.tradeIntervalMs >= 10_000) {
    updates.tradeIntervalMs = body.tradeIntervalMs
  }
  if (typeof body.maxBudgetEur === 'number' && body.maxBudgetEur > 0) updates.maxBudgetEur = body.maxBudgetEur
  if (typeof body.maxPositionPct === 'number' && body.maxPositionPct > 0 && body.maxPositionPct <= 1) updates.maxPositionPct = body.maxPositionPct
  if (typeof body.dailyLossLimitPct === 'number' && body.dailyLossLimitPct > 0 && body.dailyLossLimitPct <= 1) updates.dailyLossLimitPct = body.dailyLossLimitPct

  updateConfig(updates as Parameters<typeof updateConfig>[0])
  res.json(configResponse())
})

export default router
