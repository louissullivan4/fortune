import { Router } from 'express'
import { requireAuth, requireAdminOrAccountant } from '../middleware/auth.js'
import type { BacktestConfig } from '../../backtest/types.js'
import {
  createBacktest,
  listBacktests,
  getBacktest,
  deleteBacktest,
} from '../../backtest/journal.js'
import { enqueueBacktest } from '../../backtest/runner.js'

const router = Router()
router.use(requireAuth, requireAdminOrAccountant)

// Mirrors the validation logic from /api/config so backtest configs reject
// the same invalid values.
function validateConfig(
  body: Partial<BacktestConfig>
): { ok: true; cfg: BacktestConfig } | { ok: false; error: string } {
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { ok: false, error: 'name is required' }
  }
  if (!body.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    return { ok: false, error: 'startDate must be YYYY-MM-DD' }
  }
  if (!body.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
    return { ok: false, error: 'endDate must be YYYY-MM-DD' }
  }
  if (body.endDate < body.startDate)
    return { ok: false, error: 'endDate must be on or after startDate' }
  const spanDays = (Date.parse(body.endDate) - Date.parse(body.startDate)) / 86_400_000
  if (spanDays > 730)
    return { ok: false, error: 'Range too large — Yahoo hourly data is limited to ~730 days' }

  if (typeof body.initialCash !== 'number' || body.initialCash < 10) {
    return { ok: false, error: 'initialCash must be a number ≥ €10' }
  }
  if (!Array.isArray(body.tradeUniverse) || body.tradeUniverse.length === 0) {
    return { ok: false, error: 'tradeUniverse must be a non-empty array of tickers' }
  }
  const numFields: Array<[keyof BacktestConfig, number, number]> = [
    ['maxBudgetEur', 1, 1_000_000],
    ['maxPositionPct', 0.01, 1],
    ['dailyLossLimitPct', 0.001, 1],
    ['stopLossPct', 0.001, 1],
    ['takeProfitPct', 0.001, 1],
    ['stagnantTimeMinutes', 1, 10_000],
    ['stagnantRangePct', 0.0001, 1],
    ['softStopHoldMinutes', 1, 10_000],
    ['softStopDrawdownPct', 0.001, 1],
    ['tradeIntervalMs', 1000, 24 * 60 * 60 * 1000],
  ]
  for (const [k, min, max] of numFields) {
    const v = body[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      return { ok: false, error: `${String(k)} must be a number between ${min} and ${max}` }
    }
  }

  const cfg: BacktestConfig = {
    name: body.name.trim(),
    startDate: body.startDate,
    endDate: body.endDate,
    initialCash: body.initialCash,
    tradeUniverse: body.tradeUniverse.map(String),
    tradeIntervalMs: body.tradeIntervalMs!,
    maxBudgetEur: body.maxBudgetEur!,
    maxPositionPct: body.maxPositionPct!,
    dailyLossLimitPct: body.dailyLossLimitPct!,
    stopLossPct: body.stopLossPct!,
    takeProfitPct: body.takeProfitPct!,
    stagnantExitEnabled: body.stagnantExitEnabled ?? true,
    stagnantTimeMinutes: body.stagnantTimeMinutes!,
    stagnantRangePct: body.stagnantRangePct!,
    softStopEnabled: body.softStopEnabled ?? true,
    softStopHoldMinutes: body.softStopHoldMinutes!,
    softStopDrawdownPct: body.softStopDrawdownPct!,
    autoStartOnRestart: body.autoStartOnRestart ?? false,
  }
  return { ok: true, cfg }
}

// GET /api/backtests?page=1&limit=20
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const { data, total } = await listBacktests(req.user!.userId, page, limit)
    res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
})

// GET /api/backtests/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await getBacktest(id, req.user!.userId)
    if (!row) return res.status(404).json({ error: 'Backtest not found' })
    res.json(row)
  } catch (err) {
    next(err)
  }
})

// POST /api/backtests
router.post('/', async (req, res, next) => {
  try {
    const result = validateConfig(req.body as Partial<BacktestConfig>)
    if (!result.ok) return res.status(400).json({ error: result.error })
    const row = await createBacktest(req.user!.userId, result.cfg)
    enqueueBacktest(row.id)
    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// POST /api/backtests/:id/rerun
router.post('/:id/rerun', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const original = await getBacktest(id, req.user!.userId)
    if (!original) return res.status(404).json({ error: 'Backtest not found' })

    // Merge any overrides from the body on top of the original config
    const overrides = (req.body as Partial<BacktestConfig>) ?? {}
    const merged: Partial<BacktestConfig> = {
      ...original.configJson,
      ...overrides,
      name: overrides.name ?? `${original.configJson.name} (rerun)`,
    }
    const result = validateConfig(merged)
    if (!result.ok) return res.status(400).json({ error: result.error })
    const row = await createBacktest(req.user!.userId, result.cfg)
    enqueueBacktest(row.id)
    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/backtests/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const ok = await deleteBacktest(id, req.user!.userId)
    if (!ok) return res.status(404).json({ error: 'Backtest not found' })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
