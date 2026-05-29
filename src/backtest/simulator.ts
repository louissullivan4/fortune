import type { OHLCV, TickerHistory } from '../api/marketdata.js'
import type {
  PortfolioSnapshot,
  T212Position,
  T212Instrument,
  Trading212Client,
} from '../api/trading212.js'
import { generateSignals } from '../strategy/signals.js'
import { pickDecision, type PickerDecision, type StagnantInfo } from '../strategy/picker.js'
import { validateOrder, computeBuyQuantity, sizePartialExit } from '../engine/riskmanager.js'
import { inferMarketFromTicker } from '../markets/registry.js'
import type { BacktestConfig, BacktestMetrics, ClosedTrade, EquityPoint } from './types.js'

interface SimPosition {
  ticker: string
  quantity: number
  /** Fill price in the instrument's native currency. */
  entryPrice: number
  /** EUR per native unit at entry (frozen for cost-basis accounting). */
  entryFxRate: number
  /** Remaining cost basis in EUR, incl. the entry-leg FX cost. Scales down on partial. */
  costEurGross: number
  openedAtMs: number
  /** Highest close seen since open (native). Drives trailing-stop arming. */
  highWaterMark: number
  /** Timestamp (ms) a partial take-profit fired, else null. */
  partialExitAt: number | null
}

interface SimState {
  /** Account cash in EUR. */
  cash: number
  positions: Map<string, SimPosition>
  closedTrades: ClosedTrade[]
  // Day boundary tracking for daily loss limit
  currentDay: string | null
  dailyOpenValue: number
  /** Previous trading day's open value — daily-loss limit references this (matches live). */
  prevDayOpenValue: number
  // 14-day ticker circuit breaker
  recentLosses: Map<string, number[]>
  // Last sell for the picker's same-day rebuy guard
  lastSell: { ticker: string; ms: number } | null
  /** ticker → dayKey of last full close. Blocks same-day re-entry (mirrors live cooldown). */
  closedToday: Map<string, string>
  /** ticker → last cycle's close. Momentum guard for stagnant exits (mirrors live). */
  lastSeenClose: Map<string, number>
  equityCurve: EquityPoint[]
  cycles: number
  buysExecuted: number
  sellsExecuted: number
  blockedByRisk: number
  signalsEvaluated: number
}

/** EUR per native-currency unit, sampled at a point in time. */
export type FxRateResolver = (ms: number, currency: string) => number

const HOUR_MS = 60 * 60 * 1000
// These MUST match the live engine's exit tuning (src/engine/EngineService.ts).
// Percentages, not fractions: 3.0 = 3%, 1.5 = 1.5%. Pinned by simulator.parity.test.ts.
const TRAIL_ACTIVATION_PCT = 3.0 // +3% above entry (or HWM) → trailing armed
const TRAIL_STOP_PCT = 1.5 // 1.5% drawdown from HWM → trail-exit
// Cash gating, also mirrored from the live engine.
const CASH_BUFFER_EUR = 5
const MIN_DEPLOYABLE_EUR = 6
// Rolling indicator window — live fetches this many days of 1h bars each cycle.
// Slicing the same trailing window keeps EMA/MACD seed points identical to live.
const SIGNAL_HISTORY_DAYS = 45

function applySlippage(price: number, side: 'buy' | 'sell', slippageBps: number): number {
  const factor = slippageBps / 10_000
  return side === 'buy' ? price * (1 + factor) : price * (1 - factor)
}

/** Instrument denomination currency for a T212 ticker (USD for NYSE, EUR for Xetra…). */
function currencyOf(ticker: string): string {
  return inferMarketFromTicker(ticker)?.currency ?? 'EUR'
}

function makeStubT212Client(universe: string[]): Trading212Client {
  const instruments = new Map<string, T212Instrument>(
    universe.map((t) => [
      t,
      {
        ticker: t,
        name: t,
        shortName: t,
        currencyCode: currencyOf(t),
        type: 'STOCK',
        minTradeQuantity: 0.01,
      },
    ])
  )
  // Risk manager only calls getInstruments(); everything else is unused.
  return { getInstruments: async () => instruments } as unknown as Trading212Client
}

function buildSnapshot(
  state: SimState,
  priceMap: Map<string, number>,
  fxFor: (ticker: string) => number
): PortfolioSnapshot {
  const positions: T212Position[] = []
  for (const [ticker, p] of state.positions) {
    const currentPrice = priceMap.get(ticker) ?? p.entryPrice
    const fxRate = fxFor(ticker)
    const valueEur = currentPrice * p.quantity * fxRate
    const costBasisEur = p.costEurGross
    positions.push({
      ticker,
      quantity: p.quantity,
      averagePrice: p.entryPrice,
      currentPrice,
      ppl: valueEur - costBasisEur,
      fxPpl: null,
      initialFillDate: new Date(p.openedAtMs).toISOString(),
      maxBuy: null,
      maxSell: null,
      currencyCode: currencyOf(ticker),
      fxRate,
      valueEur,
      costBasisEur,
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

/** Fully close a position. exitPrice is native; cash and P&L are EUR. */
function closePosition(
  state: SimState,
  ticker: string,
  exitPrice: number,
  closedAtMs: number,
  reason: ClosedTrade['exitReason'],
  fxRateAt: FxRateResolver,
  fxRoundTripPct = 0
): void {
  const p = state.positions.get(ticker)
  if (!p) return
  const currency = currencyOf(ticker)
  const fx = fxRateAt(closedAtMs, currency)
  const proceedsGrossEur = p.quantity * exitPrice * fx
  const fxCostEur = currency !== 'EUR' ? proceedsGrossEur * (fxRoundTripPct / 2) : 0
  const proceedsNetEur = proceedsGrossEur - fxCostEur
  state.cash += proceedsNetEur
  const realized = proceedsNetEur - p.costEurGross
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
  state.closedToday.set(ticker, dayKey(closedAtMs))
}

/** Scale out part of a position at a take-profit (mirrors live partial exit). */
function partialClose(
  state: SimState,
  ticker: string,
  exitPrice: number,
  closedAtMs: number,
  sellQty: number,
  fxRateAt: FxRateResolver,
  fxRoundTripPct = 0
): void {
  const p = state.positions.get(ticker)
  if (!p || sellQty <= 0 || sellQty >= p.quantity) return
  const currency = currencyOf(ticker)
  const fx = fxRateAt(closedAtMs, currency)
  const fraction = sellQty / p.quantity
  const costChunk = p.costEurGross * fraction
  const proceedsGrossEur = sellQty * exitPrice * fx
  const fxCostEur = currency !== 'EUR' ? proceedsGrossEur * (fxRoundTripPct / 2) : 0
  const proceedsNetEur = proceedsGrossEur - fxCostEur
  state.cash += proceedsNetEur
  state.closedTrades.push({
    ticker,
    openedAt: new Date(p.openedAtMs).toISOString(),
    closedAt: new Date(closedAtMs).toISOString(),
    quantity: sellQty,
    entryPrice: p.entryPrice,
    exitPrice,
    realizedPnl: proceedsNetEur - costChunk,
    exitReason: 'partial',
    holdMinutes: Math.round((closedAtMs - p.openedAtMs) / 60000),
  })
  p.quantity -= sellQty
  p.costEurGross -= costChunk
  p.partialExitAt = closedAtMs
  state.sellsExecuted++
}

/**
 * Hard exits, evaluated against this cycle's bar CLOSE only — exactly what the
 * live poller sees (it never has intrabar high/low). Mirrors
 * EngineService._checkHardExits: SL/TP/trailing/soft-stop, partial take-profit,
 * and the breakeven + tightened-trail behaviour after a partial.
 */
function checkHardExits(
  state: SimState,
  ts: number,
  barAtTs: Map<string, OHLCV>,
  config: BacktestConfig,
  fxRateAt: FxRateResolver = () => 1
): void {
  const slip = config.slippageBps ?? 0
  const fxPct = config.fxRoundTripPct ?? 0
  for (const [ticker, p] of [...state.positions]) {
    const bar = barAtTs.get(ticker)
    if (!bar) continue
    const price = bar.close // single per-cycle sample, like live currentPrice

    p.highWaterMark = Math.max(p.highWaterMark, price)
    const hwm = p.highWaterMark
    const pctFromEntry = ((price - p.entryPrice) / p.entryPrice) * 100
    const pctFromPeak = ((price - hwm) / hwm) * 100
    const hasPartial = p.partialExitAt != null

    const stopLossPct = config.stopLossPct * 100
    const takeProfitPct = config.takeProfitPct * 100
    const partialExitPct = Math.max(0, Math.min(1, config.partialExitPct))
    const trailPullbackPct = hasPartial ? config.trailPullbackAfterPartialPct * 100 : TRAIL_STOP_PCT

    const isStopLoss = hasPartial ? pctFromEntry < 0 : pctFromEntry <= -stopLossPct
    const isTakeProfit = !hasPartial && pctFromEntry >= takeProfitPct
    const trailActivated =
      hasPartial ||
      pctFromEntry >= TRAIL_ACTIVATION_PCT ||
      hwm >= p.entryPrice * (1 + TRAIL_ACTIVATION_PCT / 100)
    const isTrailingStop = trailActivated && pctFromPeak <= -trailPullbackPct

    const minutesHeld = (ts - p.openedAtMs) / 60000
    const softStopThresholdPct = config.softStopDrawdownPct * 100
    const isSoftStop =
      !hasPartial &&
      config.softStopEnabled &&
      !trailActivated &&
      minutesHeld >= config.softStopHoldMinutes &&
      pctFromEntry <= -softStopThresholdPct

    if (!isStopLoss && !isTakeProfit && !isTrailingStop && !isSoftStop) continue

    const fill = applySlippage(price, 'sell', slip)

    // Partial take-profit: scale out, leave the remainder on a breakeven +
    // tightened trail (handled by the hasPartial branches above on later cycles).
    const split =
      isTakeProfit && partialExitPct < 1
        ? sizePartialExit({
            liveQty: p.quantity,
            partialFraction: partialExitPct,
            minTradeQty: 0.01,
          })
        : null
    if (split) {
      partialClose(state, ticker, fill, ts, split.partialQty, fxRateAt, fxPct)
      continue
    }

    const reason: ClosedTrade['exitReason'] = isStopLoss
      ? hasPartial
        ? 'breakeven'
        : 'stop_loss'
      : isTakeProfit
        ? 'take_profit'
        : isTrailingStop
          ? 'trailing_stop'
          : 'soft_stop'
    closePosition(state, ticker, fill, ts, reason, fxRateAt, fxPct)
  }
}

/**
 * Identify stagnant positions worth rotating. Mirrors
 * EngineService._identifyStagnantCandidates: only fires when a STRONG_BUY exists
 * on an unheld ticker, measures stagnation by |pctFromEntry|, and skips positions
 * that ran up (HWM) or are trending up vs last cycle's close.
 */
function detectStagnant(
  state: SimState,
  ts: number,
  priceMap: Map<string, number>,
  signals: ReturnType<typeof generateSignals>,
  config: BacktestConfig
): StagnantInfo[] {
  if (!config.stagnantExitEnabled || state.positions.size === 0) return []
  const held = new Set(state.positions.keys())
  const hasBetter = signals.some((s) => s.signal === 'strong_buy' && !held.has(s.ticker))
  if (!hasBetter) return []

  const out: StagnantInfo[] = []
  for (const [ticker, p] of state.positions) {
    const price = priceMap.get(ticker) ?? p.entryPrice
    const pctFromEntry = ((price - p.entryPrice) / p.entryPrice) * 100
    const minutesHeld = (ts - p.openedAtMs) / 60000
    const isStagnant =
      minutesHeld >= config.stagnantTimeMinutes &&
      Math.abs(pctFromEntry) < config.stagnantRangePct * 100
    const positionRanUp = p.highWaterMark > p.entryPrice * (1 + config.stagnantRangePct)
    const last = state.lastSeenClose.get(ticker)
    const isTrendingUp = last !== undefined && price > last
    if (!isStagnant || positionRanUp || isTrendingUp) continue
    out.push({ ticker, minutesHeld: Math.round(minutesHeld), pctFromEntry })
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
  finalPriceMap: Map<string, number>,
  fxRateAt: FxRateResolver
): BacktestMetrics {
  // Liquidate remaining open positions at the last known close for fair metrics
  const finalTs = state.equityCurve.at(-1)?.t ?? Date.parse(config.endDate)
  for (const [ticker, p] of [...state.positions]) {
    const price = finalPriceMap.get(ticker) ?? p.entryPrice
    closePosition(state, ticker, price, finalTs, 'end_of_run', fxRateAt, config.fxRoundTripPct ?? 0)
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
  onProgress: (pct: number) => void = () => {},
  fxRateAt: FxRateResolver = () => 1
): Promise<BacktestMetrics> {
  const startMs = Date.parse(config.startDate + 'T00:00:00Z')
  const endMs = Date.parse(config.endDate + 'T23:59:59Z')
  const slip = config.slippageBps ?? 0
  const fxPct = config.fxRoundTripPct ?? 0

  const t212 = makeStubT212Client(config.tradeUniverse)
  const state: SimState = {
    cash: config.initialCash,
    positions: new Map(),
    closedTrades: [],
    currentDay: null,
    dailyOpenValue: config.initialCash,
    prevDayOpenValue: config.initialCash,
    recentLosses: new Map(),
    lastSell: null,
    closedToday: new Map(),
    lastSeenClose: new Map(),
    equityCurve: [],
    cycles: 0,
    buysExecuted: 0,
    sellsExecuted: 0,
    blockedByRisk: 0,
    signalsEvaluated: 0,
  }

  const timestamps = uniqueSortedTimestamps(histories, startMs, endMs)
  if (timestamps.length === 0) {
    return computeMetrics(config, state, new Map(), fxRateAt)
  }

  // Per-ticker rolling index — advances as we walk timestamps
  const tickerIdx = new Map<string, number>()
  for (const t of histories.keys()) tickerIdx.set(t, -1)

  // Latest known close price per ticker (carried forward across gaps)
  const priceMap = new Map<string, number>()
  const windowMs = SIGNAL_HISTORY_DAYS * 24 * HOUR_MS

  const reportProgress = (cycle: number): void => {
    if (cycle % 50 === 0) onProgress(Math.floor((cycle / timestamps.length) * 100))
  }

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

    // 1) Hard exits (close-sampled). Runs BEFORE the daily-loss gate, like live.
    checkHardExits(state, ts, barAtTs, config, fxRateAt)

    const fxFor = (ticker: string): number => fxRateAt(ts, currencyOf(ticker))

    // 2) Snapshot + day rollover
    const snapshot = buildSnapshot(state, priceMap, fxFor)
    const dayId = dayKey(ts)
    if (state.currentDay !== dayId) {
      if (state.currentDay !== null) state.prevDayOpenValue = state.dailyOpenValue
      state.currentDay = dayId
      state.dailyOpenValue = snapshot.totalValue
    }
    state.equityCurve.push({ t: ts, value: snapshot.totalValue })

    // 3) Daily loss limit — vs PREVIOUS day's open; halts the whole cycle (like live).
    const drawdown =
      (state.prevDayOpenValue - snapshot.totalValue) / Math.max(1, state.prevDayOpenValue)
    if (drawdown > config.dailyLossLimitPct) {
      reportProgress(cycle)
      continue
    }

    // 4) Budget envelope: cap deployable to the bot's budget less open exposure (like live).
    const aiPositionsValue = snapshot.positions.reduce((s, p) => s + p.valueEur, 0)
    const botCash = Math.max(
      0,
      Math.min(config.maxBudgetEur - aiPositionsValue, snapshot.cash.free)
    )
    const botSnapshot: PortfolioSnapshot = {
      ...snapshot,
      cash: { ...snapshot.cash, free: botCash },
    }

    // 5) Buy universe: exclude held + same-day-closed (cooldown) tickers, like live.
    const heldTickers = new Set(state.positions.keys())
    const coolingTickers = new Set(
      [...state.closedToday].filter(([, d]) => d === dayId).map(([t]) => t)
    )
    const buyUniverse = config.tradeUniverse.filter(
      (t) => !heldTickers.has(t) && !coolingTickers.has(t)
    )

    // 6) Per-cycle sliced histories over the trailing SIGNAL_HISTORY_DAYS window
    //    (matches live's rolling fetch so EMA/MACD seed points are identical).
    const cutoff = ts - windowMs
    const sliced = new Map<string, TickerHistory>()
    for (const [ticker, history] of histories) {
      const idx = tickerIdx.get(ticker)!
      if (idx < 0) continue
      const bars: OHLCV[] = []
      for (let i = 0; i <= idx; i++) {
        if (history.bars[i].date.getTime() >= cutoff) bars.push(history.bars[i])
      }
      sliced.set(ticker, { ticker, bars })
    }

    const signals = generateSignals(buyUniverse, sliced, snapshot.positions)
    state.signalsEvaluated += signals.length

    // 7) Stagnant detection (parity with live)
    const stagnant = detectStagnant(state, ts, priceMap, signals, config)

    // 8) Cash-constrained hold gate (mirror live)
    const deployable = botCash - CASH_BUFFER_EUR
    if (deployable < MIN_DEPLOYABLE_EUR && stagnant.length === 0) {
      reportProgress(cycle)
      // last-seen prices intentionally NOT updated — live returns before its update too
      continue
    }

    // 9) Deterministic decision (shared picker)
    const decision = pickDecision({
      signals,
      snapshot: botSnapshot,
      stagnant,
      config: { stagnantRangePct: config.stagnantRangePct },
      lastSell: state.lastSell,
      nowMs: ts,
    })

    // 10) Execute the picker's decision
    let aiSoldTicker: string | null = null
    if (decision.action !== 'hold' && decision.ticker && decision.estimatedPrice) {
      if (decision.action === 'buy') {
        const currency = currencyOf(decision.ticker)
        const fx = fxRateAt(ts, currency)
        const qty = computeBuyQuantity(
          decision.ticker,
          decision.estimatedPrice,
          botSnapshot,
          config,
          0.01,
          0.5,
          fx
        )
        if (qty <= 0) {
          state.blockedByRisk++
        } else {
          const decisionVal = await validateOrder(
            {
              action: 'buy',
              ticker: decision.ticker,
              quantity: qty,
              estimatedPrice: decision.estimatedPrice,
            },
            botSnapshot,
            state.dailyOpenValue,
            t212,
            config,
            botSnapshot.totalValue,
            state.dailyOpenValue,
            countRecentLosses(state, decision.ticker, ts),
            fx
          )
          if (!decisionVal.allowed) {
            state.blockedByRisk++
          } else {
            const fill = applySlippage(decision.estimatedPrice, 'buy', slip)
            const fxEntryCostMult = currency !== 'EUR' ? 1 + fxPct / 2 : 1
            const costEurGross = qty * fill * fx * fxEntryCostMult
            state.cash -= costEurGross
            state.positions.set(decision.ticker, {
              ticker: decision.ticker,
              quantity: qty,
              entryPrice: fill,
              entryFxRate: fx,
              costEurGross,
              openedAtMs: ts,
              highWaterMark: fill,
              partialExitAt: null,
            })
            state.buysExecuted++
          }
        }
      } else if (decision.action === 'sell' && state.positions.has(decision.ticker)) {
        // The deterministic picker only ever sells to rotate a stagnant position.
        const price = priceMap.get(decision.ticker) ?? decision.estimatedPrice
        closePosition(
          state,
          decision.ticker,
          applySlippage(price, 'sell', slip),
          ts,
          'stagnant_rotation',
          fxRateAt,
          fxPct
        )
        aiSoldTicker = decision.ticker
      }
    }

    // 11) Close the remaining stagnant candidates this cycle (mirror live _executeStagnantExits)
    for (const cand of stagnant) {
      if (cand.ticker === aiSoldTicker) continue
      const held = state.positions.get(cand.ticker)
      if (!held) continue
      const price = priceMap.get(cand.ticker) ?? held.entryPrice
      closePosition(
        state,
        cand.ticker,
        applySlippage(price, 'sell', slip),
        ts,
        'stagnant_rotation',
        fxRateAt,
        fxPct
      )
    }

    // 12) Update last-seen closes (momentum guard) — mirrors live end-of-cycle update
    for (const [ticker, close] of priceMap) state.lastSeenClose.set(ticker, close)

    reportProgress(cycle)
  }

  onProgress(100)
  return computeMetrics(config, state, priceMap, fxRateAt)
}

// Re-export for tests / unit use
export {
  applySlippage,
  buildSnapshot,
  makeStubT212Client,
  checkHardExits,
  closePosition,
  currencyOf,
}
export type { SimState, SimPosition }
export type { PickerDecision, StagnantInfo }
