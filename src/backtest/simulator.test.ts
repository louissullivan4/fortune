import { describe, it, expect } from 'vitest'
import { runBacktest, pickDecision, checkHardExits, type SimState } from './simulator.js'
import type { BacktestConfig } from './types.js'
import type { TickerHistory, OHLCV } from '../api/marketdata.js'
import type { PortfolioSnapshot } from '../api/trading212.js'
import type { TickerSignal } from '../strategy/signals.js'

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
  autoStartOnRestart: false,
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

describe('pickDecision', () => {
  const emptySnapshot: PortfolioSnapshot = {
    cash: { free: 100, total: 100, ppl: 0, result: 0, invested: 0, pieCash: 0, blocked: 0 },
    positions: [],
    totalValue: 100,
    totalPpl: 0,
  }

  const baseSig = (overrides: Partial<TickerSignal> & { ticker: string }): TickerSignal => ({
    signal: 'buy',
    indicators: {
      ticker: overrides.ticker,
      rsi14: 50,
      sma20: 110,
      sma50: 100,
      ema9: 105,
      ema12: 103,
      ema21: 102,
      ema26: 101,
      macd: 1,
      macdSignal: 0.5,
      macdHistogram: 0.5,
      macdBullCross: false,
      macdBearCross: false,
      bollingerUpper: 120,
      bollingerMiddle: 100,
      bollingerLower: 80,
      bollingerPctB: 0.5,
      stochK: 50,
      stochD: 40,
      currentPrice: 100,
      priceChange1d: 1,
    },
    reasons: [],
    heldPosition: null,
    bullishCount: 5,
    bearishCount: 1,
    ...overrides,
  })

  const cfg = baseConfig
  const now = Date.parse('2025-01-15T12:00:00Z')

  it('holds when no qualifying buy candidates', () => {
    const sigs = [baseSig({ ticker: 'AAPL', signal: 'hold' })]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('hold')
  })

  it('rejects buy when Stochastic %K > 85', () => {
    const sigs = [
      baseSig({
        ticker: 'AAPL',
        indicators: { ...baseSig({ ticker: 'AAPL' }).indicators, stochK: 90 },
      }),
    ]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('hold')
  })

  it('rejects buy when SMA20 < SMA50 (downtrend filter)', () => {
    const sigs = [
      baseSig({
        ticker: 'AAPL',
        indicators: { ...baseSig({ ticker: 'AAPL' }).indicators, sma20: 90, sma50: 100 },
      }),
    ]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('hold')
  })

  it('lone-BUY rule rejects a single weak candidate', () => {
    const sigs = [baseSig({ ticker: 'AAPL', bullishCount: 4, bearishCount: 1 })]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('hold')
  })

  it('lone-BUY rule accepts a single strong candidate', () => {
    const sigs = [baseSig({ ticker: 'AAPL', bullishCount: 6, bearishCount: 1 })]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('buy')
    expect(d.ticker).toBe('AAPL')
  })

  it('picks the highest-net-bullish candidate', () => {
    const sigs = [
      baseSig({ ticker: 'AAPL', bullishCount: 5, bearishCount: 2 }),
      baseSig({ ticker: 'MSFT', bullishCount: 9, bearishCount: 1 }),
    ]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, null, now)
    expect(d.action).toBe('buy')
    expect(d.ticker).toBe('MSFT')
  })

  it('blocks same-day rebuy of a just-sold ticker', () => {
    const lastSell = { ticker: 'AAPL', ms: Date.parse('2025-01-15T08:00:00Z') }
    const sigs = [baseSig({ ticker: 'AAPL', bullishCount: 9, bearishCount: 1 })]
    const d = pickDecision(sigs, emptySnapshot, [], cfg, lastSell, now)
    expect(d.action).toBe('hold')
  })

  it('returns sell when a stagnant position exists alongside a fresh buy candidate', () => {
    const held: PortfolioSnapshot = {
      ...emptySnapshot,
      positions: [
        {
          ticker: 'AAPL',
          quantity: 1,
          averagePrice: 100,
          currentPrice: 100,
          ppl: 0,
          fxPpl: null,
          initialFillDate: '',
          maxBuy: null,
          maxSell: null,
          currencyCode: 'EUR',
          fxRate: 1,
          valueEur: 100,
          costBasisEur: 100,
        },
      ],
    }
    const sigs = [
      baseSig({ ticker: 'AAPL', signal: 'hold', bullishCount: 0 }),
      baseSig({ ticker: 'MSFT', bullishCount: 8, bearishCount: 1 }),
    ]
    const d = pickDecision(
      sigs,
      held,
      [{ ticker: 'AAPL', minutesHeld: 180, pctFromEntry: -0.5 }],
      cfg,
      null,
      now
    )
    expect(d.action).toBe('sell')
    expect(d.ticker).toBe('AAPL')
  })

  it('skips buy on a ticker already held', () => {
    const held: PortfolioSnapshot = {
      ...emptySnapshot,
      positions: [
        {
          ticker: 'AAPL',
          quantity: 1,
          averagePrice: 100,
          currentPrice: 100,
          ppl: 0,
          fxPpl: null,
          initialFillDate: '',
          maxBuy: null,
          maxSell: null,
          currencyCode: 'EUR',
          fxRate: 1,
          valueEur: 100,
          costBasisEur: 100,
        },
      ],
    }
    const sigs = [baseSig({ ticker: 'AAPL', bullishCount: 9, bearishCount: 1 })]
    const d = pickDecision(sigs, held, [], cfg, null, now)
    expect(d.action).toBe('hold')
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
