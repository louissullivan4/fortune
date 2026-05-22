import type { OHLCV, TickerHistory } from '../api/marketdata.js'
import type {
  PortfolioSnapshot,
  T212Position,
  T212Instrument,
  Trading212Client,
} from '../api/trading212.js'
import { generateSignals } from '../strategy/signals.js'
import { pickDecision, type PickerDecision, type StagnantInfo } from '../strategy/picker.js'
import { validateOrder, computeBuyQuantity } from '../engine/riskmanager.js'
import type { BacktestConfig, BacktestMetrics, ClosedTrade, EquityPoint } from './types.js'

interface SimPosition {
  ticker: string
  quantity: number
  entryPrice: number
  openedAtMs: number
  highWaterMark: number
  /** Min close seen since open — used together with HWM for stagnant range. */
  lowWaterMark: number
}

interface SimState {
  cash: number
  positions: Map<string, SimPosition>
  closedTrades: ClosedTrade[]
  // Day boundary tracking for daily loss limit
  currentDay: string | null
  dailyOpenValue: number
  // 14-day ticker circuit breaker
  recentLosses: Map<string, number[]>
  // Last decision for same-day rebuy guard
  lastSell: { ticker: string; ms: number } | null
  equityCurve: EquityPoint[]
  cycles: number
  buysExecuted: number
  sellsExecuted: number
  blockedByRisk: number
  signalsEvaluated: number
}

const HOUR_MS = 60 * 60 * 1000
const TRAIL_ACTIVATION_PCT = 0.008 // 0.8% above entry → trailing armed
const TRAIL_STOP_PCT = 0.004 // 0.4% drawdown from HWM → trail-exit

function makeStubT212Client(universe: string[]): Trading212Client {
  const instruments = new Map<string, T212Instrument>(
    universe.map((t) => [
      t,
      {
        ticker: t,
        name: t,
        shortName: t,
        currencyCode: 'EUR',
        type: 'STOCK',
        minTradeQuantity: 0.01,
      },
    ])
  )
  // Risk manager only calls getInstruments(); everything else is unused.
  return { getInstruments: async () => instruments } as unknown as Trading212Client
}

function buildSnapshot(state: SimState, priceMap: Map<string, number>): PortfolioSnapshot {
  const positions: T212Position[] = []
  for (const [ticker, p] of state.positions) {
    const currentPrice = priceMap.get(ticker) ?? p.entryPrice
    const ppl = (currentPrice - p.entryPrice) * p.quantity
    positions.push({
      ticker,
      quantity: p.quantity,
      averagePrice: p.entryPrice,
      currentPrice,
      ppl,
      fxPpl: null,
      initialFillDate: new Date(p.openedAtMs).toISOString(),
      maxBuy: null,
      maxSell: null,
      currencyCode: 'EUR',
      fxRate: 1,
      valueEur: currentPrice * p.quantity,
      costBasisEur: p.entryPrice * p.quantity,
    })
  }
  const invested = positions.reduce((s, q) => s + q.costBasisEur, 0)
  const positionValue = positions.reduce((s, q) => s + q.valueEur, 0)
  const totalValue = state.cash + positionValue
  return {
    cash: {
      free: state.cash,
      total: totalValue,
      ppl: positionValue - invested,
      result: 0,
      invested,
      pieCash: 0,
      blocked: 0,
    },
    positions,
    totalValue,
    totalPpl: positionValue - invested,
  }
}

function dayKey(ms: number): string {
  // UTC date — consistent across timezones for backtest determinism
  return new Date(ms).toISOString().slice(0, 10)
}

function closePosition(
  state: SimState,
  ticker: string,
  exitPrice: number,
  closedAtMs: number,
  reason: ClosedTrade['exitReason']
): void {
  const p = state.positions.get(ticker)
  if (!p) return
  const realized = (exitPrice - p.entryPrice) * p.quantity
  state.cash += p.quantity * exitPrice
  state.closedTrades.push({
    ticker,
    openedAt: new Date(p.openedAtMs).toISOString(),
    closedAt: new Date(closedAtMs).toISOString(),
    quantity: p.quantity,
    entryPrice: p.entryPrice,
    exitPrice,
    realizedPnl: realized,
    exitReason: reason,
    holdMinutes: Math.round((closedAtMs - p.openedAtMs) / 60000),
  })
  state.positions.delete(ticker)
  state.sellsExecuted++
  if (realized < 0) {
    const arr = state.recentLosses.get(ticker) ?? []
    arr.push(closedAtMs)
    state.recentLosses.set(ticker, arr)
  }
  state.lastSell = { ticker, ms: closedAtMs }
}

function checkHardExits(
  state: SimState,
  ts: number,
  barAtTs: Map<string, OHLCV>,
  config: BacktestConfig
): void {
  for (const [ticker, p] of [...state.positions]) {
    const bar = barAtTs.get(ticker)
    if (!bar) continue

    const slPrice = p.entryPrice * (1 - config.stopLossPct)
    const tpPrice = p.entryPrice * (1 + config.takeProfitPct)

    // Intra-bar checks: if SL and TP both triggered in the same bar, take the
    // worse outcome (SL) — the engine cannot tell which came first intraday.
    if (bar.low <= slPrice) {
      closePosition(state, ticker, slPrice, ts, 'stop_loss')
      continue
    }
    if (bar.high >= tpPrice) {
      closePosition(state, ticker, tpPrice, ts, 'take_profit')
      continue
    }

    // Trailing stop: update HWM, then if armed and close pulls back enough
    p.highWaterMark = Math.max(p.highWaterMark, bar.high)
    p.lowWaterMark = Math.min(p.lowWaterMark, bar.low)
    const armed = p.highWaterMark >= p.entryPrice * (1 + TRAIL_ACTIVATION_PCT)
    if (armed) {
      const trailLevel = p.highWaterMark * (1 - TRAIL_STOP_PCT)
      if (bar.low <= trailLevel) {
        closePosition(state, ticker, trailLevel, ts, 'trailing_stop')
        continue
      }
    }

    // Soft time-stop — only relevant when trailing has never armed, because
    // armed positions are managed by the trailing-stop logic above.
    if (config.softStopEnabled && !armed) {
      const minutesHeld = (ts - p.openedAtMs) / 60000
      const softStopPrice = p.entryPrice * (1 - config.softStopDrawdownPct)
      if (minutesHeld >= config.softStopHoldMinutes && bar.close <= softStopPrice) {
        closePosition(state, ticker, bar.close, ts, 'soft_stop')
      }
    }
  }
}

function detectStagnant(
  state: SimState,
  ts: number,
  priceMap: Map<string, number>,
  config: BacktestConfig
): StagnantInfo[] {
  if (!config.stagnantExitEnabled) return []
  const out: StagnantInfo[] = []
  for (const [ticker, p] of state.positions) {
    const minutes = (ts - p.openedAtMs) / 60000
    if (minutes < config.stagnantTimeMinutes) continue
    const price = priceMap.get(ticker) ?? p.entryPrice
    const range = (p.highWaterMark - p.lowWaterMark) / p.entryPrice
    if (range >= config.stagnantRangePct) continue
    const pctFromEntry = ((price - p.entryPrice) / p.entryPrice) * 100
    out.push({ ticker, minutesHeld: Math.round(minutes), pctFromEntry })
  }
  return out
}

function countRecentLosses(state: SimState, ticker: string, nowMs: number): number {
  const arr = state.recentLosses.get(ticker)
  if (!arr) return 0
  const cutoff = nowMs - 14 * 24 * HOUR_MS
  return arr.filter((t) => t >= cutoff).length
}

function uniqueSortedTimestamps(
  histories: Map<string, TickerHistory>,
  startMs: number,
  endMs: number
): number[] {
  const set = new Set<number>()
  for (const h of histories.values()) {
    for (const b of h.bars) {
      const t = b.date.getTime()
      if (t >= startMs && t <= endMs) set.add(t)
    }
  }
  return [...set].sort((a, b) => a - b)
}

function computeMetrics(
  config: BacktestConfig,
  state: SimState,
  finalPriceMap: Map<string, number>
): BacktestMetrics {
  // Liquidate remaining open positions at the last known close for fair metrics
  const finalTs = state.equityCurve.at(-1)?.t ?? Date.parse(config.endDate)
  for (const [ticker, p] of [...state.positions]) {
    const price = finalPriceMap.get(ticker) ?? p.entryPrice
    closePosition(state, ticker, price, finalTs, 'end_of_run')
  }

  const finalValue = state.cash
  const realizedPnl = state.closedTrades.reduce((s, t) => s + t.realizedPnl, 0)
  const totalReturnPct = (finalValue / config.initialCash - 1) * 100
  const wins = state.closedTrades.filter((t) => t.realizedPnl > 0).length
  const losses = state.closedTrades.filter((t) => t.realizedPnl < 0).length
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null

  // Max drawdown from equity curve
  let peak = config.initialCash
  let maxDd = 0
  for (const pt of state.equityCurve) {
    if (pt.value > peak) peak = pt.value
    const dd = (peak - pt.value) / peak
    if (dd > maxDd) maxDd = dd
  }

  // Sharpe: annualised from bar-to-bar returns
  let sharpe: number | null = null
  if (state.equityCurve.length > 2) {
    const returns: number[] = []
    for (let i = 1; i < state.equityCurve.length; i++) {
      const prev = state.equityCurve[i - 1].value
      const cur = state.equityCurve[i].value
      if (prev > 0) returns.push(cur / prev - 1)
    }
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
    const std = Math.sqrt(variance)
    // ~6.5 trading hours × 252 days = 1638 hourly bars/year
    if (std > 0) sharpe = (mean / std) * Math.sqrt(1638)
  }

  return {
    initialCash: config.initialCash,
    finalValue,
    realizedPnl,
    totalReturnPct,
    maxDrawdownPct: maxDd * 100,
    winRate,
    tradesCount: state.closedTrades.length,
    sharpe,
    equityCurve: state.equityCurve,
    trades: state.closedTrades,
    cyclesRun: state.cycles,
    signalsEvaluated: state.signalsEvaluated,
    buysExecuted: state.buysExecuted,
    sellsExecuted: state.sellsExecuted,
    blockedByRisk: state.blockedByRisk,
  }
}

export async function runBacktest(
  config: BacktestConfig,
  histories: Map<string, TickerHistory>,
  onProgress: (pct: number) => void = () => {}
): Promise<BacktestMetrics> {
  const startMs = Date.parse(config.startDate + 'T00:00:00Z')
  const endMs = Date.parse(config.endDate + 'T23:59:59Z')

  const t212 = makeStubT212Client(config.tradeUniverse)
  const state: SimState = {
    cash: config.initialCash,
    positions: new Map(),
    closedTrades: [],
    currentDay: null,
    dailyOpenValue: config.initialCash,
    recentLosses: new Map(),
    lastSell: null,
    equityCurve: [],
    cycles: 0,
    buysExecuted: 0,
    sellsExecuted: 0,
    blockedByRisk: 0,
    signalsEvaluated: 0,
  }

  const timestamps = uniqueSortedTimestamps(histories, startMs, endMs)
  if (timestamps.length === 0) {
    return computeMetrics(config, state, new Map())
  }

  // Per-ticker rolling index — advances as we walk timestamps
  const tickerIdx = new Map<string, number>()
  for (const t of histories.keys()) tickerIdx.set(t, -1)

  // Latest known close price per ticker (carried forward across gaps)
  const priceMap = new Map<string, number>()

  for (let cycle = 0; cycle < timestamps.length; cycle++) {
    const ts = timestamps[cycle]
    state.cycles++

    // Advance each ticker's bar index up to ts, populate this-bar map
    const barAtTs = new Map<string, OHLCV>()
    for (const [ticker, history] of histories) {
      let idx = tickerIdx.get(ticker)!
      while (idx + 1 < history.bars.length && history.bars[idx + 1].date.getTime() <= ts) {
        idx++
        const bar = history.bars[idx]
        if (bar.date.getTime() === ts) barAtTs.set(ticker, bar)
        priceMap.set(ticker, bar.close)
      }
      tickerIdx.set(ticker, idx)
    }

    // 1) Hard exits (SL / TP / trailing) against this bar's high/low
    checkHardExits(state, ts, barAtTs, config)

    // 2) Snapshot + day rollover
    const snapshot = buildSnapshot(state, priceMap)
    const dayId = dayKey(ts)
    if (state.currentDay !== dayId) {
      state.currentDay = dayId
      state.dailyOpenValue = snapshot.totalValue
    }

    state.equityCurve.push({ t: ts, value: snapshot.totalValue })

    // 3) Daily loss limit gate
    const drawdown =
      (state.dailyOpenValue - snapshot.totalValue) / Math.max(1, state.dailyOpenValue)
    const buysHalted = drawdown > config.dailyLossLimitPct

    // 4) Build per-ticker sliced histories for signal calc (closes-only data)
    const sliced = new Map<string, TickerHistory>()
    for (const [ticker, history] of histories) {
      const idx = tickerIdx.get(ticker)!
      if (idx < 0) continue
      sliced.set(ticker, { ticker, bars: history.bars.slice(0, idx + 1) })
    }

    const signals = generateSignals(config.tradeUniverse, sliced, snapshot.positions)
    state.signalsEvaluated += signals.length

    // 5) Stagnant detection
    const stagnant = detectStagnant(state, ts, priceMap, config)

    // 6) Deterministic decision
    const decision = pickDecision({
      signals,
      snapshot,
      stagnant,
      config: { stagnantRangePct: config.stagnantRangePct },
      lastSell: state.lastSell,
      nowMs: ts,
    })

    if (decision.action === 'hold' || !decision.ticker || !decision.estimatedPrice) {
      if (cycle % 50 === 0) onProgress(Math.floor((cycle / timestamps.length) * 100))
      continue
    }

    // If buys are halted by daily-loss, skip; sells (rotation) still allowed
    if (buysHalted && decision.action === 'buy') {
      if (cycle % 50 === 0) onProgress(Math.floor((cycle / timestamps.length) * 100))
      continue
    }

    // 7) Risk validation
    let qty = decision.quantity ?? 0
    if (decision.action === 'buy') {
      qty = computeBuyQuantity(decision.ticker, decision.estimatedPrice, snapshot, config)
      if (qty <= 0) {
        state.blockedByRisk++
        continue
      }
    }
    const recentLosses = countRecentLosses(state, decision.ticker, ts)
    const decisionVal = await validateOrder(
      {
        action: decision.action,
        ticker: decision.ticker,
        quantity: qty,
        estimatedPrice: decision.estimatedPrice,
      },
      snapshot,
      state.dailyOpenValue,
      t212,
      config,
      snapshot.totalValue,
      state.dailyOpenValue,
      recentLosses
    )
    if (!decisionVal.allowed) {
      state.blockedByRisk++
      continue
    }

    // 8) Execute at this bar's close (or last known close if no bar at ts)
    const fillPrice = decision.estimatedPrice
    if (decision.action === 'buy') {
      const costEur = qty * fillPrice
      state.cash -= costEur
      state.positions.set(decision.ticker, {
        ticker: decision.ticker,
        quantity: qty,
        entryPrice: fillPrice,
        openedAtMs: ts,
        highWaterMark: fillPrice,
        lowWaterMark: fillPrice,
      })
      state.buysExecuted++
    } else if (decision.action === 'sell') {
      closePosition(state, decision.ticker, fillPrice, ts, 'stagnant_rotation')
    }

    if (cycle % 50 === 0) onProgress(Math.floor((cycle / timestamps.length) * 100))
  }

  onProgress(100)
  return computeMetrics(config, state, priceMap)
}

// Re-export for tests / unit use
export { buildSnapshot, makeStubT212Client, checkHardExits, closePosition }
export type { SimState, SimPosition }
export type { PickerDecision, StagnantInfo }
