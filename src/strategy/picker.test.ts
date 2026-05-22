import { describe, it, expect } from 'vitest'
import { pickDecision, lastSellFromRecentDecisions, type PickerInput } from './picker.js'
import type { TickerSignal } from './signals.js'
import type { PortfolioSnapshot } from '../api/trading212.js'
import type { RecentDecision } from '../analytics/journal.js'

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

const heldSnapshot = (ticker: string): PortfolioSnapshot => ({
  ...emptySnapshot,
  positions: [
    {
      ticker,
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
})

const now = Date.parse('2025-01-15T12:00:00Z')

function input(overrides: Partial<PickerInput> & { signals: TickerSignal[] }): PickerInput {
  return {
    snapshot: emptySnapshot,
    stagnant: [],
    config: { stagnantRangePct: 0.012 },
    lastSell: null,
    nowMs: now,
    ...overrides,
  }
}

describe('pickDecision', () => {
  it('holds when no qualifying buy candidates', () => {
    const d = pickDecision(input({ signals: [baseSig({ ticker: 'AAPL', signal: 'hold' })] }))
    expect(d.action).toBe('hold')
  })

  it('rejects buy when Stochastic %K > 85', () => {
    const sig = baseSig({ ticker: 'AAPL' })
    const d = pickDecision(
      input({ signals: [{ ...sig, indicators: { ...sig.indicators, stochK: 90 } }] })
    )
    expect(d.action).toBe('hold')
  })

  it('rejects buy when SMA20 ≤ SMA50 (downtrend filter)', () => {
    const sig = baseSig({ ticker: 'AAPL' })
    const d = pickDecision(
      input({ signals: [{ ...sig, indicators: { ...sig.indicators, sma20: 90, sma50: 100 } }] })
    )
    expect(d.action).toBe('hold')
  })

  it('rejects buy when net bullish < 3', () => {
    const d = pickDecision(
      input({ signals: [baseSig({ ticker: 'AAPL', bullishCount: 3, bearishCount: 1 })] })
    )
    expect(d.action).toBe('hold')
  })

  it('lone-BUY rule rejects a single weak candidate', () => {
    const d = pickDecision(
      input({ signals: [baseSig({ ticker: 'AAPL', bullishCount: 4, bearishCount: 1 })] })
    )
    expect(d.action).toBe('hold')
  })

  it('lone-BUY rule accepts a single strong candidate', () => {
    const d = pickDecision(
      input({ signals: [baseSig({ ticker: 'AAPL', bullishCount: 6, bearishCount: 1 })] })
    )
    expect(d.action).toBe('buy')
    expect(d.ticker).toBe('AAPL')
  })

  it('picks the highest net-bullish candidate', () => {
    const d = pickDecision(
      input({
        signals: [
          baseSig({ ticker: 'AAPL', bullishCount: 5, bearishCount: 2 }),
          baseSig({ ticker: 'MSFT', bullishCount: 9, bearishCount: 1 }),
        ],
      })
    )
    expect(d.action).toBe('buy')
    expect(d.ticker).toBe('MSFT')
  })

  it('tiebreaks on strong_buy over buy', () => {
    const d = pickDecision(
      input({
        signals: [
          baseSig({ ticker: 'AAPL', signal: 'buy', bullishCount: 6, bearishCount: 1 }),
          baseSig({ ticker: 'MSFT', signal: 'strong_buy', bullishCount: 6, bearishCount: 1 }),
        ],
      })
    )
    expect(d.ticker).toBe('MSFT')
  })

  it('blocks same-day rebuy of a just-sold ticker', () => {
    const d = pickDecision(
      input({
        signals: [baseSig({ ticker: 'AAPL', bullishCount: 9, bearishCount: 1 })],
        lastSell: { ticker: 'AAPL', ms: Date.parse('2025-01-15T08:00:00Z') },
      })
    )
    expect(d.action).toBe('hold')
  })

  it('allows next-day rebuy of a previously-sold ticker', () => {
    const d = pickDecision(
      input({
        signals: [baseSig({ ticker: 'AAPL', bullishCount: 9, bearishCount: 1 })],
        lastSell: { ticker: 'AAPL', ms: Date.parse('2025-01-14T08:00:00Z') },
      })
    )
    expect(d.action).toBe('buy')
  })

  it('returns sell when a stagnant position exists alongside a fresh buy candidate', () => {
    const d = pickDecision(
      input({
        snapshot: heldSnapshot('AAPL'),
        signals: [
          baseSig({ ticker: 'AAPL', signal: 'hold', bullishCount: 0 }),
          baseSig({ ticker: 'MSFT', bullishCount: 8, bearishCount: 1 }),
        ],
        stagnant: [{ ticker: 'AAPL', minutesHeld: 180, pctFromEntry: -0.5 }],
      })
    )
    expect(d.action).toBe('sell')
    expect(d.ticker).toBe('AAPL')
  })

  it('skips buy on a ticker already held', () => {
    const d = pickDecision(
      input({
        snapshot: heldSnapshot('AAPL'),
        signals: [baseSig({ ticker: 'AAPL', bullishCount: 9, bearishCount: 1 })],
      })
    )
    expect(d.action).toBe('hold')
  })
})

describe('lastSellFromRecentDecisions', () => {
  it('returns null when no sells', () => {
    const decisions: RecentDecision[] = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        action: 'buy',
        ticker: 'AAPL',
        quantity: 1,
        reasoning: '',
      },
      {
        timestamp: '2025-01-15T09:00:00Z',
        action: 'hold',
        ticker: null,
        quantity: null,
        reasoning: '',
      },
    ]
    expect(lastSellFromRecentDecisions(decisions)).toBeNull()
  })

  it('returns the most recent sell (input is DESC by timestamp)', () => {
    const decisions: RecentDecision[] = [
      {
        timestamp: '2025-01-15T12:00:00Z',
        action: 'hold',
        ticker: null,
        quantity: null,
        reasoning: '',
      },
      {
        timestamp: '2025-01-15T11:00:00Z',
        action: 'sell',
        ticker: 'AAPL',
        quantity: 1,
        reasoning: '',
      },
      {
        timestamp: '2025-01-15T10:00:00Z',
        action: 'sell',
        ticker: 'MSFT',
        quantity: 1,
        reasoning: '',
      },
    ]
    const hint = lastSellFromRecentDecisions(decisions)
    expect(hint?.ticker).toBe('AAPL')
    expect(hint?.ms).toBe(Date.parse('2025-01-15T11:00:00Z'))
  })

  it('ignores sells with null ticker', () => {
    const decisions: RecentDecision[] = [
      {
        timestamp: '2025-01-15T11:00:00Z',
        action: 'sell',
        ticker: null,
        quantity: null,
        reasoning: '',
      },
      {
        timestamp: '2025-01-15T10:00:00Z',
        action: 'sell',
        ticker: 'AAPL',
        quantity: 1,
        reasoning: '',
      },
    ]
    const hint = lastSellFromRecentDecisions(decisions)
    expect(hint?.ticker).toBe('AAPL')
  })
})
