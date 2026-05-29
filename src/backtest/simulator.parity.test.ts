// Parity guard: the simulator's hard-exit logic MUST stay byte-for-byte faithful
// to the live engine (src/engine/EngineService._checkHardExits). The live exit
// constants are not exported, so we hard-code the live formula here as a
// reference and assert the simulator agrees across a price/HWM sweep. If anyone
// retunes the simulator's TRAIL_* constants or exit branches without matching
// live (or vice-versa), this test fails.
//
// Scope: the non-partial path (partialExitPct = 1), which is the bulk of exits.
// Partial-exit behaviour is covered by simulator.test.ts.

import { describe, it, expect } from 'vitest'
import { checkHardExits, type SimState, type SimPosition } from './simulator.js'
import type { BacktestConfig } from './types.js'
import type { OHLCV } from '../api/marketdata.js'

const HOUR_MS = 60 * 60 * 1000
const T0 = Date.parse('2025-01-01T00:00:00Z')

// ── Live reference (mirrors EngineService._checkHardExits, partialExitPct = 1) ──
const LIVE_TRAIL_ACTIVATION_PCT = 3.0
const LIVE_TRAIL_STOP_PCT = 1.5

type ExitReason = 'stop_loss' | 'take_profit' | 'trailing_stop' | 'soft_stop' | null

function liveReferenceExit(
  entry: number,
  hwmInput: number,
  openedAtMs: number,
  ts: number,
  price: number,
  cfg: BacktestConfig
): ExitReason {
  const hwm = Math.max(hwmInput, price)
  const pctFromEntry = ((price - entry) / entry) * 100
  const pctFromPeak = ((price - hwm) / hwm) * 100

  const stopLossPct = cfg.stopLossPct * 100
  const takeProfitPct = cfg.takeProfitPct * 100

  const isStopLoss = pctFromEntry <= -stopLossPct
  const isTakeProfit = pctFromEntry >= takeProfitPct
  const trailActivated =
    pctFromEntry >= LIVE_TRAIL_ACTIVATION_PCT ||
    hwm >= entry * (1 + LIVE_TRAIL_ACTIVATION_PCT / 100)
  const isTrailingStop = trailActivated && pctFromPeak <= -LIVE_TRAIL_STOP_PCT

  const minutesHeld = (ts - openedAtMs) / 60000
  const softStopThresholdPct = cfg.softStopDrawdownPct * 100
  const isSoftStop =
    cfg.softStopEnabled &&
    !trailActivated &&
    minutesHeld >= cfg.softStopHoldMinutes &&
    pctFromEntry <= -softStopThresholdPct

  if (!isStopLoss && !isTakeProfit && !isTrailingStop && !isSoftStop) return null
  return isStopLoss
    ? 'stop_loss'
    : isTakeProfit
      ? 'take_profit'
      : isTrailingStop
        ? 'trailing_stop'
        : 'soft_stop'
}

function singlePositionState(entry: number, hwm: number, openedAtMs: number): SimState {
  const p: SimPosition = {
    ticker: 'AAPL',
    quantity: 1,
    entryPrice: entry,
    entryFxRate: 1,
    costEurGross: entry,
    openedAtMs,
    highWaterMark: hwm,
    partialExitAt: null,
  }
  return {
    cash: 0,
    positions: new Map([['AAPL', p]]),
    closedTrades: [],
    currentDay: null,
    dailyOpenValue: 100,
    prevDayOpenValue: 100,
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
}

function barAt(close: number, ts: number): OHLCV {
  return { date: new Date(ts), open: close, high: close, low: close, close, volume: 1 }
}

describe('simulator ↔ live hard-exit parity', () => {
  const cfg: BacktestConfig = {
    name: 'parity',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    initialCash: 100,
    tradeUniverse: ['AAPL'],
    tradeIntervalMs: 900_000,
    maxBudgetEur: 100,
    maxPositionPct: 0.5,
    dailyLossLimitPct: 0.1,
    stopLossPct: 0.05,
    takeProfitPct: 0.06,
    stagnantExitEnabled: false,
    stagnantTimeMinutes: 120,
    stagnantRangePct: 0.012,
    softStopEnabled: true,
    softStopHoldMinutes: 360,
    softStopDrawdownPct: 0.025,
    partialExitPct: 1, // no scale-out → exercise the non-partial path
    trailPullbackAfterPartialPct: 0.003,
    decisionMode: 'deterministic',
    aiCostBudgetMonthlyUsd: 5,
    autoStartOnRestart: false,
    market: 'NYSE',
  }

  const entry = 100
  const ts = T0 + 7 * HOUR_MS // past the soft-stop hold window

  for (const hwm of [100, 102, 103.5, 106]) {
    it(`matches the live exit decision across the price sweep (hwm=${hwm})`, () => {
      for (let price = 90; price <= 112; price += 0.25) {
        const expected = liveReferenceExit(entry, hwm, T0, ts, price, cfg)
        const state = singlePositionState(entry, hwm, T0)
        checkHardExits(state, ts, new Map([['AAPL', barAt(price, ts)]]), cfg)
        const actual = state.closedTrades[0]?.exitReason ?? null
        expect(actual, `hwm=${hwm} price=${price}`).toBe(expected)
      }
    })
  }
})
