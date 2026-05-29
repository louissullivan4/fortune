import { describe, it, expect } from 'vitest'
import {
  applySlippage,
  runBacktest,
  checkHardExits,
  closePosition,
  type SimState,
  type SimPosition,
} from './simulator.js'
import type { BacktestConfig } from './types.js'
import type { TickerHistory, OHLCV } from '../api/marketdata.js'

const HOUR_MS = 60 * 60 * 1000
const T0 = Date.parse('2025-01-01T00:00:00Z')

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
  // Soft stop disabled by default; soft-stop-specific tests opt in explicitly.
  softStopEnabled: false,
  softStopHoldMinutes: 360,
  softStopDrawdownPct: 0.025,
  // partialExitPct=1 → no scale-out, full close at TP. Partial-exit tests opt in.
  partialExitPct: 1,
  trailPullbackAfterPartialPct: 0.003,
  decisionMode: 'ai',
  aiCostBudgetMonthlyUsd: 5,
  autoStartOnRestart: false,
  market: 'NYSE',
}

function makeBars(startMs: number, closes: number[]): OHLCV[] {
  // high/low are kept near close; the close-sampled engine only reads close,
  // so these are cosmetic but realistic.
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

// ── Shared SimState / SimPosition factories ───────────────────────────────────

function makePosition(overrides: Partial<SimPosition> = {}): SimPosition {
  return {
    ticker: 'AAPL',
    quantity: 1,
    entryPrice: 100,
    entryFxRate: 1,
    costEurGross: 100,
    openedAtMs: T0,
    highWaterMark: 100,
    partialExitAt: null,
    ...overrides,
  }
}

function makeState(position?: Partial<SimPosition>, cash = 0): SimState {
  const state: SimState = {
    cash,
    positions: new Map(),
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
  const p = makePosition(position)
  state.positions.set(p.ticker, p)
  return state
}

function bar(close: number, ts = T0 + HOUR_MS): OHLCV {
  return {
    date: new Date(ts),
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1,
  }
}

describe('runBacktest', () => {
  it('returns zero trades when no bars in range', async () => {
    const cfg = { ...baseConfig, startDate: '2025-06-01', endDate: '2025-06-02' }
    const m = await runBacktest(cfg, new Map())
    expect(m.tradesCount).toBe(0)
    expect(m.finalValue).toBe(cfg.initialCash)
  })

  it('liquidates open positions at end-of-run so finalValue accounts for them', async () => {
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
    expect(m.finalValue).toBeGreaterThan(0)
    expect(m.equityCurve.length).toBeGreaterThan(0)
  })

  it('halts the cycle after the daily loss limit is breached vs the previous-day open', async () => {
    // Rise enough to open, then crash >10% intraday — drawdown vs prev-day open
    // (= initialCash on day 1) trips the limit and halts further buys.
    const start = Date.parse('2025-01-02T00:00:00Z')
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 60; i++) {
      p *= 1.002
      closes.push(p)
    }
    for (let i = 0; i < 5; i++) {
      p *= 0.95
      closes.push(p)
    }
    const histories = new Map([['AAPL', { ticker: 'AAPL', bars: makeBars(start, closes) }]])
    const cfg = {
      ...baseConfig,
      dailyLossLimitPct: 0.05,
      startDate: '2025-01-02',
      endDate: '2025-01-03',
      tradeUniverse: ['AAPL'],
    }
    const m = await runBacktest(cfg, histories)
    // One position at most before the halt; the crash blocks re-entry.
    expect(m.buysExecuted).toBeLessThanOrEqual(2)
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

  it('runs to completion with a non-unity FX resolver on a USD universe', async () => {
    const start = Date.parse('2025-01-01T00:00:00Z')
    const histories = new Map([['NVDA_US_EQ', trendingHistory('NVDA_US_EQ', start, 150, 0.0015)]])
    const cfg = { ...baseConfig, tradeUniverse: ['NVDA_US_EQ'] }
    const m = await runBacktest(
      cfg,
      histories,
      () => {},
      () => 0.9
    )
    expect(Number.isFinite(m.finalValue)).toBe(true)
    expect(m.finalValue).toBeGreaterThan(0)
  })
})

describe('checkHardExits (close-sampled, live-parity)', () => {
  const cfg: BacktestConfig = { ...baseConfig, stopLossPct: 0.05, takeProfitPct: 0.015 }
  const ts = T0 + HOUR_MS

  it('fires stop-loss when the close is ≤ entry × (1 − stopLossPct)', () => {
    const state = makeState()
    checkHardExits(state, ts, new Map([['AAPL', bar(94, ts)]]), cfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('stop_loss')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(94)
  })

  it('fires take-profit (full close) when partialExitPct = 1', () => {
    const state = makeState()
    checkHardExits(state, ts, new Map([['AAPL', bar(102, ts)]]), cfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('take_profit')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(102)
  })

  it('does not exit on a small gain that crosses no threshold', () => {
    const state = makeState()
    checkHardExits(state, ts, new Map([['AAPL', bar(100.2, ts)]]), cfg)
    expect(state.closedTrades).toHaveLength(0)
  })

  it('fills hard exits at the close with slippage (not at the threshold)', () => {
    const state = makeState()
    checkHardExits(state, ts, new Map([['AAPL', bar(102, ts)]]), { ...cfg, slippageBps: 15 })
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(102 * (1 - 0.0015), 4)
  })

  describe('trailing stop — pins the live 3.0% arm / 1.5% pullback constants', () => {
    // Use a high takeProfit so TP never pre-empts the trailing-stop assertions.
    const trailCfg: BacktestConfig = { ...baseConfig, stopLossPct: 0.05, takeProfitPct: 0.1 }

    it('does NOT arm the trail below +3% (HWM only +2%)', () => {
      const state = makeState({ highWaterMark: 102 })
      // 2% pullback from peak would fire IF armed — proving it is not armed yet.
      checkHardExits(state, ts, new Map([['AAPL', bar(100, ts)]]), trailCfg)
      expect(state.closedTrades).toHaveLength(0)
    })

    it('arms the trail once HWM ≥ +3% and exits on a pullback past 1.5%', () => {
      const state = makeState({ highWaterMark: 104 })
      // pctFromPeak = (102.3 − 104) / 104 = −1.63% ≤ −1.5% → trailing
      checkHardExits(state, ts, new Map([['AAPL', bar(102.3, ts)]]), trailCfg)
      expect(state.closedTrades).toHaveLength(1)
      expect(state.closedTrades[0].exitReason).toBe('trailing_stop')
    })

    it('does NOT exit when the pullback from peak is shallower than 1.5%', () => {
      const state = makeState({ highWaterMark: 104 })
      // pctFromPeak = (102.6 − 104) / 104 = −1.35% > −1.5% → no exit
      checkHardExits(state, ts, new Map([['AAPL', bar(102.6, ts)]]), trailCfg)
      expect(state.closedTrades).toHaveLength(0)
    })
  })

  describe('partial take-profit', () => {
    const partialCfg: BacktestConfig = {
      ...baseConfig,
      stopLossPct: 0.05,
      takeProfitPct: 0.015,
      partialExitPct: 0.5,
      trailPullbackAfterPartialPct: 0.003,
    }

    it('scales out partialExitPct at TP and leaves the remainder open', () => {
      const state = makeState({ quantity: 1 })
      checkHardExits(state, ts, new Map([['AAPL', bar(102, ts)]]), partialCfg)
      expect(state.closedTrades).toHaveLength(1)
      expect(state.closedTrades[0].exitReason).toBe('partial')
      expect(state.closedTrades[0].quantity).toBeCloseTo(0.5)
      const remaining = state.positions.get('AAPL')!
      expect(remaining.quantity).toBeCloseTo(0.5)
      expect(remaining.partialExitAt).not.toBeNull()
    })

    it('exits the remainder at breakeven once it dips below entry after a partial', () => {
      const state = makeState({ quantity: 0.5, partialExitAt: ts, highWaterMark: 102 })
      checkHardExits(state, ts + HOUR_MS, new Map([['AAPL', bar(99, ts + HOUR_MS)]]), partialCfg)
      expect(state.closedTrades).toHaveLength(1)
      expect(state.closedTrades[0].exitReason).toBe('breakeven')
    })

    it('rides the tightened trail (0.3%) on the remainder after a partial', () => {
      const state = makeState({ quantity: 0.5, partialExitAt: ts, highWaterMark: 104 })
      // still above entry (no breakeven), pctFromPeak = (103.6 − 104)/104 = −0.38% ≤ −0.3%
      checkHardExits(state, ts + HOUR_MS, new Map([['AAPL', bar(103.6, ts + HOUR_MS)]]), partialCfg)
      expect(state.closedTrades).toHaveLength(1)
      expect(state.closedTrades[0].exitReason).toBe('trailing_stop')
    })
  })
})

describe('soft time-stop', () => {
  const enabledCfg: BacktestConfig = {
    ...baseConfig,
    softStopEnabled: true,
    softStopHoldMinutes: 360,
    softStopDrawdownPct: 0.025,
  }

  it('fires when held ≥ softStopHoldMinutes AND close ≤ entry × (1 − drawdown)', () => {
    const ts = T0 + 7 * HOUR_MS
    const state = makeState({ openedAtMs: T0 })
    checkHardExits(state, ts, new Map([['AAPL', bar(97, ts)]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('soft_stop')
    expect(state.closedTrades[0].exitPrice).toBeCloseTo(97)
  })

  it('does NOT fire before softStopHoldMinutes has elapsed', () => {
    const ts = T0 + 3 * HOUR_MS
    const state = makeState({ openedAtMs: T0 })
    checkHardExits(state, ts, new Map([['AAPL', bar(97, ts)]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(0)
  })

  it('does NOT fire when drawdown is shallower than threshold', () => {
    const ts = T0 + 10 * HOUR_MS
    const state = makeState({ openedAtMs: T0 })
    checkHardExits(state, ts, new Map([['AAPL', bar(99, ts)]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(0)
  })

  it('does NOT fire when the trail is armed (exits as trailing instead)', () => {
    const ts = T0 + 10 * HOUR_MS
    const state = makeState({ openedAtMs: T0, highWaterMark: 104 })
    checkHardExits(state, ts, new Map([['AAPL', bar(97, ts)]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('trailing_stop')
  })

  it('does NOT fire when softStopEnabled is false', () => {
    const ts = T0 + 10 * HOUR_MS
    const state = makeState({ openedAtMs: T0 })
    checkHardExits(state, ts, new Map([['AAPL', bar(97, ts)]]), {
      ...enabledCfg,
      softStopEnabled: false,
    })
    expect(state.closedTrades).toHaveLength(0)
  })

  it('stop_loss takes precedence when both thresholds are breached', () => {
    const ts = T0 + 10 * HOUR_MS
    const state = makeState({ openedAtMs: T0 })
    checkHardExits(state, ts, new Map([['AAPL', bar(94, ts)]]), enabledCfg)
    expect(state.closedTrades).toHaveLength(1)
    expect(state.closedTrades[0].exitReason).toBe('stop_loss')
  })
})

describe('applySlippage', () => {
  it('makes buys more expensive', () => {
    expect(applySlippage(100, 'buy', 15)).toBeCloseTo(100.15, 4)
  })
  it('makes sells cheaper', () => {
    expect(applySlippage(100, 'sell', 15)).toBeCloseTo(99.85, 4)
  })
  it('returns the exact price when slippage is 0', () => {
    expect(applySlippage(100, 'buy', 0)).toBe(100)
    expect(applySlippage(100, 'sell', 0)).toBe(100)
  })
})

describe('FX-aware accounting', () => {
  it('closePosition credits EUR proceeds using the historical FX rate', () => {
    const state = makeState({ ticker: 'NVDA_US_EQ', entryFxRate: 0.9, costEurGross: 90 }, 0)
    // currencyOf('NVDA_US_EQ') = USD → fxRateAt(.., 'USD') = 0.9
    closePosition(state, 'NVDA_US_EQ', 100, T0 + HOUR_MS, 'take_profit', () => 0.9, 0)
    // proceeds = 1 × 100 × 0.9 = 90 EUR
    expect(state.cash).toBeCloseTo(90, 6)
    expect(state.closedTrades[0].realizedPnl).toBeCloseTo(0, 6)
  })

  it('applies the round-trip FX cost on the exit leg for non-EUR tickers', () => {
    const state = makeState({ ticker: 'NVDA_US_EQ', entryFxRate: 0.9, costEurGross: 90 }, 0)
    closePosition(state, 'NVDA_US_EQ', 100, T0 + HOUR_MS, 'take_profit', () => 0.9, 0.003)
    // fxCost = 90 × 0.0015 = 0.135 → cash 89.865, realized −0.135
    expect(state.cash).toBeCloseTo(89.865, 4)
    expect(state.closedTrades[0].realizedPnl).toBeCloseTo(-0.135, 4)
  })

  it('does NOT apply FX cost for EUR tickers', () => {
    const state = makeState({ ticker: 'AAPL', entryFxRate: 1, costEurGross: 100 }, 0)
    closePosition(state, 'AAPL', 100, T0 + HOUR_MS, 'take_profit', () => 1, 0.003)
    expect(state.cash).toBeCloseTo(100, 6)
  })

  it('records same-day close so the cooldown can block re-entry', () => {
    const state = makeState({ ticker: 'AAPL' }, 0)
    closePosition(state, 'AAPL', 96, T0 + HOUR_MS, 'stop_loss', () => 1, 0)
    expect(state.closedToday.get('AAPL')).toBe('2025-01-01')
  })
})
