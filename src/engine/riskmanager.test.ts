import { describe, it, expect, vi } from 'vitest'
import { validateOrder, computeBuyQuantity } from './riskmanager.js'
import type { PortfolioSnapshot, T212Position } from '../api/trading212.js'
import type { UserConfig } from '../types/user.js'

const BASE_CONFIG: UserConfig = {
  tradeUniverse: [],
  tradeIntervalMs: 60_000,
  maxBudgetEur: 100,
  maxPositionPct: 0.25,
  dailyLossLimitPct: 0.1,
  stopLossPct: 0.05,
  takeProfitPct: 0.015,
  stagnantExitEnabled: false,
  stagnantTimeMinutes: 120,
  stagnantRangePct: 0.01,
  autoStartOnRestart: false,
}

function makeSnapshot(overrides?: Partial<PortfolioSnapshot>): PortfolioSnapshot {
  return {
    cash: { free: 50, total: 150, ppl: 0, result: 0, invested: 100, pieCash: 0, blocked: 0 },
    positions: [],
    totalValue: 150,
    totalPpl: 0,
    ...overrides,
  }
}

function makePosition(ticker: string, qty: number, avgPrice: number): T212Position {
  return {
    ticker,
    quantity: qty,
    averagePrice: avgPrice,
    currentPrice: avgPrice,
    ppl: 0,
    fxPpl: null,
    initialFillDate: new Date().toISOString(),
    maxBuy: null,
    maxSell: null,
  }
}

function makeMockT212(minQtyByTicker: Record<string, number> = {}) {
  const map = new Map(
    Object.entries(minQtyByTicker).map(([ticker, minTradeQuantity]) => [
      ticker,
      {
        ticker,
        name: ticker,
        shortName: ticker,
        currencyCode: 'USD',
        type: 'STOCK',
        minTradeQuantity,
      },
    ])
  )
  return { getInstruments: vi.fn().mockResolvedValue(map) } as never
}

describe('validateOrder', () => {
  describe('daily loss halt', () => {
    it('blocks when portfolio drawdown exceeds the daily loss limit', async () => {
      const snapshot = makeSnapshot({ totalValue: 85 })
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 1, estimatedPrice: 10 },
        snapshot,
        100,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/daily loss limit/i)
    })

    it('allows when drawdown is within the limit', async () => {
      const snapshot = makeSnapshot({ totalValue: 95 })
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 1, estimatedPrice: 10 },
        snapshot,
        100,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(true)
    })
  })

  describe('minimum trade quantity', () => {
    it('blocks when order quantity is below the instrument minimum', async () => {
      const result = await validateOrder(
        { action: 'buy', ticker: 'TSLA', quantity: 0.005, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212({ TSLA: 0.01 }),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/minimum trade quantity/i)
    })

    it('allows when quantity meets the minimum', async () => {
      const result = await validateOrder(
        { action: 'buy', ticker: 'TSLA', quantity: 0.01, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212({ TSLA: 0.01 }),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(true)
    })

    it('skips the minimum check when the ticker is not in the catalogue', async () => {
      const result = await validateOrder(
        { action: 'buy', ticker: 'UNKNOWN', quantity: 0.001, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(true)
    })
  })

  describe('buy validation', () => {
    it('blocks when order cost exceeds the hard budget cap', async () => {
      const snapshot = makeSnapshot({
        cash: { free: 300, total: 300, ppl: 0, result: 0, invested: 0, pieCash: 0, blocked: 0 },
        totalValue: 300,
      })
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 20, estimatedPrice: 10 },
        snapshot,
        300, // dailyOpenValue === totalValue → 0% drawdown, passes the loss halt check
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/budget cap/i)
    })

    it('blocks when free cash after order would fall below the €5 buffer', async () => {
      const snapshot = makeSnapshot({
        cash: { free: 44, total: 144, ppl: 0, result: 0, invested: 100, pieCash: 0, blocked: 0 },
      })
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 4, estimatedPrice: 10 },
        snapshot,
        144,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/insufficient free cash/i)
    })

    it('blocks when already holding a position in the ticker', async () => {
      const snapshot = makeSnapshot({ positions: [makePosition('AAPL', 1, 150)] })
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 1, estimatedPrice: 10 },
        snapshot,
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/already holding/i)
    })

    it('blocks when order cost would exceed the max position size', async () => {
      // maxBudget €100 × maxPositionPct 0.25 = max position €25; order = 3 × €10 = €30
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 3, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/max size/i)
    })

    it('allows a valid buy order that satisfies all constraints', async () => {
      // 2 × €10 = €20 ≤ €25 max position, free cash €50 - €20 = €30 > €5 buffer
      const result = await validateOrder(
        { action: 'buy', ticker: 'AAPL', quantity: 2, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })
  })

  describe('sell validation', () => {
    it('blocks when no position is held in the ticker', async () => {
      const result = await validateOrder(
        { action: 'sell', ticker: 'AAPL', quantity: 1, estimatedPrice: 10 },
        makeSnapshot(),
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/no position held/i)
    })

    it('blocks when sell quantity exceeds the held amount', async () => {
      const snapshot = makeSnapshot({ positions: [makePosition('AAPL', 1, 150)] })
      const result = await validateOrder(
        { action: 'sell', ticker: 'AAPL', quantity: 2, estimatedPrice: 150 },
        snapshot,
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/only holding/i)
    })

    it('allows a valid sell within the held quantity', async () => {
      const snapshot = makeSnapshot({ positions: [makePosition('AAPL', 5, 150)] })
      const result = await validateOrder(
        { action: 'sell', ticker: 'AAPL', quantity: 3, estimatedPrice: 150 },
        snapshot,
        150,
        makeMockT212(),
        BASE_CONFIG
      )
      expect(result.allowed).toBe(true)
    })
  })
})

describe('computeBuyQuantity', () => {
  it('returns 0 when estimated price is 0', () => {
    expect(computeBuyQuantity('AAPL', 0, makeSnapshot(), BASE_CONFIG)).toBe(0)
  })

  it('returns 0 when free cash minus the €5 buffer is non-positive', () => {
    const snapshot = makeSnapshot({
      cash: { free: 5, total: 105, ppl: 0, result: 0, invested: 100, pieCash: 0, blocked: 0 },
    })
    expect(computeBuyQuantity('AAPL', 10, snapshot, BASE_CONFIG)).toBe(0)
  })

  it('returns 0 when the resulting quantity would be below minTradeQuantity', () => {
    const snapshot = makeSnapshot({
      cash: { free: 6, total: 106, ppl: 0, result: 0, invested: 100, pieCash: 0, blocked: 0 },
    })
    // targetSpend = min(50, 1, 25) = 1; qty = floor(1/10*100)/100 = 0.1; 0.1 < 0.15 → 0
    expect(computeBuyQuantity('AAPL', 10, snapshot, BASE_CONFIG, 0.15)).toBe(0)
  })

  it('calculates fractional quantity based on budget constraints', () => {
    // targetSpend = min(100*0.5=50, 50-5=45, 100*0.25=25) = 25
    // qty = floor(25/10 * 100) / 100 = 2.5
    expect(computeBuyQuantity('AAPL', 10, makeSnapshot(), BASE_CONFIG)).toBe(2.5)
  })

  it('is limited by remaining position room when partially invested', () => {
    const snapshot = makeSnapshot({ positions: [makePosition('AAPL', 1, 15)] })
    // maxPositionValue = 25; existingValue = 15; remaining = 10
    // targetSpend = min(50, 45, 10) = 10; qty = floor(10/10*100)/100 = 1
    expect(computeBuyQuantity('AAPL', 10, snapshot, BASE_CONFIG)).toBe(1)
  })

  it('uses the custom targetFraction parameter', () => {
    // targetFraction=0.25 → target = min(100*0.25=25, 45, 25) = 25; qty = 2.5
    const qty025 = computeBuyQuantity('AAPL', 10, makeSnapshot(), BASE_CONFIG, 0.01, 0.25)
    const qty050 = computeBuyQuantity('AAPL', 10, makeSnapshot(), BASE_CONFIG, 0.01, 0.5)
    // Both yield 25 because maxPositionPct cap = 25 dominates
    expect(qty025).toBe(qty050)
  })
})
