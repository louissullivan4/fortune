import { Router } from 'express'
import { requireAuth, requireAdminOrAccountant } from '../middleware/auth.js'
import type { BacktestConfig } from '../../backtest/types.js'
import {
  createBacktest,
  listBacktests,
  getBacktest,
  getVariantOf,
  deleteBacktest,
} from '../../backtest/journal.js'
import { enqueueBacktest } from '../../backtest/runner.js'
import { MARKET_CODES } from '../../markets/registry.js'

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

  const market = body.market ?? 'NYSE'
  if (!MARKET_CODES.includes(market)) {
    return { ok: false, error: `market must be one of: ${MARKET_CODES.join(', ')}` }
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
    // Partial-exit not yet modelled in the simulator (Feature 3). Default to
    // full close at take-profit so backtests retain pre-020 semantics.
    partialExitPct: body.partialExitPct ?? 1,
    trailPullbackAfterPartialPct: body.trailPullbackAfterPartialPct ?? 0.003,
    market,
    // Backtests always run the shared deterministic picker; these fields are
    // captured in the config snapshot for parity but ignored by the simulator.
    decisionMode: 'deterministic',
    aiCostBudgetMonthlyUsd: 0,
    autoStartOnRestart: body.autoStartOnRestart ?? false,
  }
  return { ok: true, cfg }
}

// GET /api/backtests?page=1&limit=20&market=NYSE
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const market = req.query.market as string | undefined
    if (market !== undefined && !MARKET_CODES.includes(market)) {
      return res.status(400).json({ error: `Unknown market: ${market}` })
    }
    const { data, total } = await listBacktests(req.user!.userId, page, limit, market)
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
    const variant = await getVariantOf(id, req.user!.userId)
    res.json({ ...row, variant: variant ?? undefined })
  } catch (err) {
    next(err)
  }
})

// POST /api/backtests
router.post('/', async (req, res, next) => {
  try {
    const body = req.body as { variantB?: Partial<BacktestConfig> } & Partial<BacktestConfig>
    const result = validateConfig(body)
    if (!result.ok) return res.status(400).json({ error: result.error })

    let variantBConfig: BacktestConfig | undefined
    if (body.variantB) {
      const vResult = validateConfig({
        ...body.variantB,
        name: result.cfg.name,
        startDate: result.cfg.startDate,
        endDate: result.cfg.endDate,
        initialCash: result.cfg.initialCash,
        market: result.cfg.market,
      })
      if (!vResult.ok) return res.status(400).json({ error: `variantB: ${vResult.error}` })
      variantBConfig = vResult.cfg
    }

    const row = await createBacktest(req.user!.userId, result.cfg)
    enqueueBacktest(row.id, variantBConfig)
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
