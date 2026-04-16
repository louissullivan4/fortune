import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserConfig } from './users.js'
import { getPool } from '../../db.js'
import { getEngine } from '../../engine/EngineService.js'

const router = Router()
router.use(requireAuth)

// GET /api/config
router.get('/', async (req, res, next) => {
  try {
    const cfg = await getUserConfig(req.user!.userId)
    if (!cfg) return res.status(404).json({ error: 'Config not found' })
    res.json({ ...cfg, tradeIntervalS: cfg.tradeIntervalMs / 1000 })
  } catch (err) {
    next(err)
  }
})

// PUT /api/config
router.put('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = req.body as Record<string, unknown>
    const pool = getPool()

    const updates: Record<string, unknown> = {}
    if (Array.isArray(body.tradeUniverse)) {
      updates.trade_universe = (body.tradeUniverse as string[]).map(String).join(',')
    }
    if (typeof body.tradeIntervalMs === 'number' && body.tradeIntervalMs >= 10_000) {
      updates.trade_interval_ms = body.tradeIntervalMs
    }
    if (typeof body.maxBudgetEur === 'number' && body.maxBudgetEur > 0) {
      updates.max_budget_eur = body.maxBudgetEur
    }
    if (
      typeof body.maxPositionPct === 'number' &&
      body.maxPositionPct > 0 &&
      body.maxPositionPct <= 1
    ) {
      updates.max_position_pct = body.maxPositionPct
    }
    if (
      typeof body.dailyLossLimitPct === 'number' &&
      body.dailyLossLimitPct > 0 &&
      body.dailyLossLimitPct <= 1
    ) {
      updates.daily_loss_limit_pct = body.dailyLossLimitPct
    }
    if (typeof body.stopLossPct === 'number' && body.stopLossPct > 0 && body.stopLossPct <= 1) {
      updates.stop_loss_pct = body.stopLossPct
    }
    if (
      typeof body.takeProfitPct === 'number' &&
      body.takeProfitPct > 0 &&
      body.takeProfitPct <= 1
    ) {
      updates.take_profit_pct = body.takeProfitPct
    }
    if (typeof body.stagnantExitEnabled === 'boolean') {
      updates.stagnant_exit_enabled = body.stagnantExitEnabled
    }
    if (typeof body.stagnantTimeMinutes === 'number' && body.stagnantTimeMinutes >= 15) {
      updates.stagnant_time_minutes = body.stagnantTimeMinutes
    }
    if (
      typeof body.stagnantRangePct === 'number' &&
      body.stagnantRangePct > 0 &&
      body.stagnantRangePct <= 0.1
    ) {
      updates.stagnant_range_pct = body.stagnantRangePct
    }
    if (typeof body.autoStartOnRestart === 'boolean') {
      updates.auto_start_on_restart = body.autoStartOnRestart
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const setClauses = Object.keys(updates)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(', ')
    await pool.query(
      `UPDATE user_configs SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
      [userId, ...Object.values(updates)]
    )

    // Propagate to running engine if active
    const engine = getEngine(userId)
    if (engine) {
      const cfg = await getUserConfig(userId)
      if (cfg) engine.updateConfig(cfg)
    }

    const cfg = await getUserConfig(userId)
    res.json({ ...cfg, tradeIntervalS: cfg!.tradeIntervalMs / 1000 })
  } catch (err) {
    next(err)
  }
})

export default router
