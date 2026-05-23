import { describe, it, expect } from 'vitest'
import { runBacktest, checkHardExits, type SimState } from './simulator.js'
import type { BacktestConfig } from './types.js'
import type { TickerHistory, OHLCV } from '../api/marketdata.js'

const HOUR_MS = 60 * 60 * 1000

const baseConfig: BacktestConfig = {
  name: 'test',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  initialCash: 100,
  tradeUniverse: ['AAPL', 'MSFT'],
  tradeIntervalMs: 900_000,
  maxBudgetEur: 100,
  maxPositionPct: 0.5,
  dailyLossLimitPct: 0.1,
  stopLossPct: 0.05,
  takeProfitPct: 0.015,
  stagnantExitEnabled: false,
  stagnantTimeMinutes: 120,
  stagnantRangePct: 0.012,
  // Soft stop disabled by default in tests so existing fixtures keep their
  // expected behaviour; the soft-stop-specific tests opt in explicitly.
  softStopEnabled: false,
  softStopHoldMinutes: 360,
  softStopDrawdownPct: 0.025,
  // Backtest doesn't model partial exits yet (Feature 3); 1.0 = full close at TP,
  // matches pre-020 behaviour and keeps existing simulator assertions valid.
  partialExitPct: 1,
  trailPullbackAfterPartialPct: 0.003,
  decisionMode: 'ai',
  aiCostBudgetMonthlyUsd: 5,
  autoStartOnRestart: false,
  market: 'NYSE',
}

function makeBars(startMs: number, closes: number[]): OHLCV[] {
  // Each bar's high/low are within 0.1% of close — keeps SL/TP triggers
  // predictable in tests that target specific entries/exits.
  return closes.map((c, i) => ({
    date: new Date(startMs + i * HOUR_MS),
    open: c * 0.999,
    high: c * 1.001,
    low: c * 0.999,
    close: c,
    volume: 1000,
  }))
}

function trendingHistory(
  ticker: string,
  startMs: number,
  n: number,
  slopePct: number
): TickerHistory {
  // Bars with constant up-slope of `slopePct` per bar → produces strong_buy
  const closes: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    p *= 1 + slopePct
    closes.push(p)
  }
  return { ticker, bars: makeBars(startMs, closes) }
}

function flatHistory(ticker: string, startMs: number, n: number, price = 100): TickerHistory {
  return { ticker, bars: makeBars(startMs, Array(n).fill(price)) }
}

describe('runBacktest', () => {
  it('returns zero trades when no bars in range', async () => {
    const cfg = { ...baseConfig, startDate: '2025-06-01', endDate: '2025-06-02' }
    const m = await runBacktest(cfg, new Map())
    expect(m.tradesCount).toBe(0)
    expect(m.finalValue).toBe(cfg.initialCash)
  })

  it('liquidates open positions at end-of-run so finalValue accounts for them', async () => {
    // Build a rising series so the bot opens a position then leaves it open
    const start = Date.parse('2024-12-01T00:00:00Z')
    const hist = trendingHistory('AAPL', start, 200, 0.001)
    const histories = new Map([['AAPL', hist]])
    const cfg = {
      ...baseConfig,
      startDate: '2024-12-01',
      endDate: '2024-12-09',
      tradeUniverse: ['AAPL'],
    }
    const m = await runBacktest(cfg, histories)
    // Even if exit happened automatically, finalValue should never be < zero
    expect(m.finalValue).toBeGreaterThan(0)
    expect(m.equityCurve.length).toBeGreaterThan(0)
  })

  // Stop-loss / take-profit / trailing-stop are tested via checkHardExits unit
  // tests below — hard to coax the deterministic decision engine into an
  // entry at a controlled price via runBacktest alone.

  it('halts buys after daily loss limit hit', async () => {
    // Two tickers both spike enough for entry on day 1, then crash within day 1
    const start = Date.parse('2025-01-01T00:00:00Z')
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 60; i++) {
      p *= 1.002
      closes.push(p)
    }
    // Day 1 second half: crash >10% to trip daily loss limit
    for (let i = 0; i < 5; i++) {
      p *= 0.95
      closes.push(p)
    }
    const bars = makeBars(start, closes)
    const histories = new Map([['AAPL', { ticker: 'AAPL', bars }]])
    const cfg = {
      ...baseConfig,
      dailyLossLimitPct: 0.05,
      startDate: '2025-01-01',
      endDate: '2025-01-05',
      tradeUniverse: ['AAPL'],
    }
    const m = await runBacktest(cfg, histories)
    // After daily loss limit, no more buys for the rest of the day
    expect(m.buysExecuted).toBeLessThanOrEqual(1)
  })

  it('produces a deterministic equity curve across two runs', async () => {
    const start = Date.parse('2025-01-01T00:00:00Z')
    const histories = new Map([
      ['AAPL', trendingHistory('AAPL', start, 150, 0.0015)],
      ['MSFT', flatHistory('MSFT', start, 150, 100)],
    ])
    const m1 = await runBacktest(baseConfig, histories)
    const m2 = await runBacktest(baseConfig, histories)
    expect(m1.finalValue).toBeCloseTo(m2.finalValue, 8)
    expect(m1.tradesCount).toBe(m2.tradesCount)
  })
})

describe('checkHardExits', () => {
  function makeState(): SimState {
    const state: SimState = {
      cash: 0,
      positions: new Map(),
      closedTrades: [],
      currentDay: null,
      dailyOpenValue: 100,
      recentLosses: new Map(),
      lastSell: null,
      equityCurve: [],
      cycles: 0,
      buysExecuted: 0,
      sellsExecuted: 0,
      blockedByRisk: 0,
      signalsEvaluated: 0,
    }
    state.positions.set('AAPL', {
      ticker: 'AAPL',
      quantity: 1,
      entryPrice: 100,
      openedAtMs: Date.parse('2025-01-01T00:00:00Z'),
      highWaterMark: 100,
      lowWaterMark: 100,
    })
    return state
  }

  const cfg: BacktestConfig = { ...baseConfig, stopLossPct: 0.05, takeProfitPct: 0.015 }
  const ts = Date.parse('2025-01-02T00:00:00Z')

  it('fires stop-loss when bar low ≤ entry × (1 − stopLossPct)', () => {
    const state = makeState()
    const bar: OHLCV = { date: new Date(ts), open: 99, high: 99, low: 94, close: 95, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), cfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('stop_loss')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(95)
  })

  it('fires take-profit when bar high ≥ entry × (1 + takeProfitPct)', () => {
    const state = makeState()
    const bar: OHLCV = {
      date: new Date(ts),
      open: 100,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 1,
    }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), cfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('take_profit')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(101.5)
  })

  it('fires trailing stop after HWM is armed and price pulls back', () => {
    const state = makeState()
    // Bar 1: arms the trailing stop (HWM moves to 101 which is +1% > 0.8% activation)
    // but doesn't trigger TP (TP would need 101.5 high). Use a price below TP threshold.
    state.positions.get('AAPL')!.highWaterMark = 101.0
    state.positions.get('AAPL')!.lowWaterMark = 100.5
    // Now bar: low drops to 100.0 — trail level is 101 × 0.996 = 100.596, low < trail
    const bar: OHLCV = {
      date: new Date(ts),
      open: 100.5,
      high: 100.7,
      low: 100.0,
      close: 100.2,
      volume: 1,
    }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), cfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('trailing_stop')
  })

  it('does not trigger trailing stop when HWM never armed', () => {
    const state = makeState()
    // bar: tiny gain, HWM moves only to 100.5 (< 0.8% activation), then small dip
    const bar: OHLCV = {
      date: new Date(ts),
      open: 100,
      high: 100.5,
      low: 100.1,
      close: 100.2,
      volume: 1,
    }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), cfg)
    expect(state.closedTrades).toHaveLength(0)
  })
})

describe('soft time-stop', () => {
  function makeState(openedAtMs: number): SimState {
    const state: SimState = {
      cash: 0,
      positions: new Map(),
      closedTrades: [],
      currentDay: null,
      dailyOpenValue: 100,
      recentLosses: new Map(),
      lastSell: null,
      equityCurve: [],
      cycles: 0,
      buysExecuted: 0,
      sellsExecuted: 0,
      blockedByRisk: 0,
      signalsEvaluated: 0,
    }
    state.positions.set('AAPL', {
      ticker: 'AAPL',
      quantity: 1,
      entryPrice: 100,
      openedAtMs,
      highWaterMark: 100,
      lowWaterMark: 100,
    })
    return state
  }

  const enabledCfg: BacktestConfig = {
    ...baseConfig,
    softStopEnabled: true,
    softStopHoldMinutes: 360, // 6h
    softStopDrawdownPct: 0.025, // 2.5%
  }

  it('fires when held ≥ softStopHoldMinutes AND close ≤ entry × (1 − drawdown)', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 7 * 60 * 60 * 1000 // 7h later → past 6h threshold
    const state = makeState(openedAt)
    // Close at 97 → 3% below entry, exceeds 2.5% drawdown threshold
    const bar: OHLCV = { date: new Date(ts), open: 98, high: 98.5, low: 96.8, close: 97, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('soft_stop')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(97)
  })

  it('does NOT fire before softStopHoldMinutes has elapsed', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 3 * 60 * 60 * 1000 // 3h — below 6h threshold
    const state = makeState(openedAt)
    const bar: OHLCV = { date: new Date(ts), open: 98, high: 98.5, low: 96.8, close: 97, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(0)
  })

  it('does NOT fire when drawdown is shallower than threshold', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 10 * 60 * 60 * 1000
    const state = makeState(openedAt)
    // Down only 1% — below 2.5% threshold
    const bar: OHLCV = { date: new Date(ts), open: 99, high: 99.5, low: 98.5, close: 99, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(0)
  })

  it('does NOT fire if trailing stop has armed (HWM > entry × 1.008)', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 10 * 60 * 60 * 1000
    const state = makeState(openedAt)
    // Pre-arm the trail by setting HWM > entry × 1.008
    state.positions.get('AAPL')!.highWaterMark = 102
    // Close back down to 97 — would trigger soft stop, but trail is armed
    // (and trail level = 102 × 0.996 = 101.59; close 97 < trail → trailing_stop fires)
    const bar: OHLCV = { date: new Date(ts), open: 98, high: 98.5, low: 96.8, close: 97, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('trailing_stop')
  })

  it('does NOT fire when softStopEnabled is false', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 10 * 60 * 60 * 1000
    const state = makeState(openedAt)
    const bar: OHLCV = { date: new Date(ts), open: 98, high: 98.5, low: 96.8, close: 97, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), { ...enabledCfg, softStopEnabled: false })
    expect(state.closedTrades).toHaveLength(0)
  })

  it('stop_loss still wins precedence when both thresholds breached', () => {
    const openedAt = Date.parse('2025-01-01T00:00:00Z')
    const ts = openedAt + 10 * 60 * 60 * 1000
    const state = makeState(openedAt)
    // Low pierces SL (entry × 0.95 = 95), close at 96 still below soft threshold
    const bar: OHLCV = { date: new Date(ts), open: 97, high: 97, low: 94, close: 96, volume: 1 }
    checkHardExits(state, ts, new Map([['AAPL', bar]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('stop_loss')
  })
})
