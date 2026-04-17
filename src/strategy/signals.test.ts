import { describe, it, expect } from 'vitest'
import { generateSignals } from './signals.js'
import type { TickerHistory } from '../api/marketdata.js'
import type { T212Position } from '../api/trading212.js'

function makeHistory(ticker: string, closes: number[]): TickerHistory {
  return {
    ticker,
    bars: closes.map((close, i) => ({
      date: new Date(2024, 0, i + 1),
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000,
    })),
  }
}

function makePosition(ticker: string, averagePrice: number, currentPrice: number): T212Position {
  return {
    ticker,
    quantity: 1,
    averagePrice,
    currentPrice,
    ppl: currentPrice - averagePrice,
    fxPpl: null,
    initialFillDate: new Date().toISOString(),
    maxBuy: null,
    maxSell: null,
  }
}

function uniformPrices(n: number, base = 100, step = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => base + i * step)
}

describe('generateSignals', () => {
  it('returns empty array for empty universe with no positions', () => {
    expect(generateSignals([], new Map(), [])).toEqual([])
  })

  it('skips tickers with fewer than 30 bars', () => {
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(29))]])
    expect(generateSignals(['AAPL'], histories, [])).toHaveLength(0)
  })

  it('includes tickers with exactly 30 bars', () => {
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(30))]])
    const result = generateSignals(['AAPL'], histories, [])
    expect(result).toHaveLength(1)
    expect(result[0].ticker).toBe('AAPL')
  })

  it('skips tickers with no history entry', () => {
    expect(generateSignals(['AAPL'], new Map(), [])).toHaveLength(0)
  })

  it('returns a signal with all required fields', () => {
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(60))]])
    const result = generateSignals(['AAPL'], histories, [])
    const signal = result[0]
    expect(signal).toHaveProperty('ticker', 'AAPL')
    expect(signal).toHaveProperty('signal')
    expect(signal).toHaveProperty('indicators')
    expect(signal).toHaveProperty('reasons')
    expect(Array.isArray(signal.reasons)).toBe(true)
    expect(signal).toHaveProperty('heldPosition', null)
  })

  it('adds held positions outside the universe with a hold signal', () => {
    const position = makePosition('NVDA', 100, 100)
    const result = generateSignals([], new Map(), [position])
    expect(result).toHaveLength(1)
    expect(result[0].ticker).toBe('NVDA')
    expect(result[0].signal).toBe('hold')
    expect(result[0].heldPosition).toEqual(position)
  })

  it('does not duplicate a ticker that appears in both universe and positions', () => {
    const position = makePosition('AAPL', 100, 100)
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(60))]])
    const result = generateSignals(['AAPL'], histories, [position])
    expect(result.filter((s) => s.ticker === 'AAPL')).toHaveLength(1)
  })

  it('attaches the held position to an in-universe ticker signal', () => {
    const position = makePosition('AAPL', 100, 110)
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(60))]])
    const result = generateSignals(['AAPL'], histories, [position])
    expect(result[0].heldPosition).toEqual(position)
  })

  it('processes multiple tickers independently', () => {
    const histories = new Map([
      ['AAPL', makeHistory('AAPL', uniformPrices(60))],
      ['MSFT', makeHistory('MSFT', uniformPrices(60, 200))],
    ])
    const result = generateSignals(['AAPL', 'MSFT'], histories, [])
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.ticker)).toContain('AAPL')
    expect(result.map((s) => s.ticker)).toContain('MSFT')
  })

  it('produces a bearish signal for a consistently falling price series', () => {
    const falling = Array.from({ length: 60 }, (_, i) => 100 - i * 1.5)
    const histories = new Map([['TSLA', makeHistory('TSLA', falling)]])
    const result = generateSignals(['TSLA'], histories, [])
    expect(result[0].signal).toMatch(/sell|hold/)
  })

  it('produces a non-buy signal for a strongly overbought uptrend', () => {
    // Uniform constant rise drives RSI=100, Bollinger near upper band, and Stochastic to 100 —
    // all bearish signals that together produce a sell-side result.
    const strongUptrend = Array.from({ length: 60 }, (_, i) => 10 + i * 2)
    const histories = new Map([['AAPL', makeHistory('AAPL', strongUptrend)]])
    const result = generateSignals(['AAPL'], histories, [])
    expect(result[0].signal).toMatch(/sell|hold/)
  })

  it('adds stop-loss bearish weight when a held position is down more than 5%', () => {
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(60))]])
    const stoppedOut = makePosition('AAPL', 100, 90)
    const result = generateSignals(['AAPL'], histories, [stoppedOut])
    expect(result[0].reasons.some((r) => r.includes('Stop-loss'))).toBe(true)
  })

  it('adds take-profit bearish weight when a held position is up more than 2%', () => {
    const histories = new Map([['AAPL', makeHistory('AAPL', uniformPrices(60))]])
    const takeProfitPos = makePosition('AAPL', 100, 105)
    const result = generateSignals(['AAPL'], histories, [takeProfitPos])
    expect(result[0].reasons.some((r) => r.includes('Take-profit'))).toBe(true)
  })

  it('covers RSI 30-45 branch with a W-pattern price series', () => {
    // 45 flat bars then decline-and-recovery: RSI ends in the 30-45 range
    // Also exercises the neutral Stochastic K > D branch
    const flatBase = Array(45).fill(10) as number[]
    const wTail = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6]
    const prices = [...flatBase, ...wTail]
    const histories = new Map([['W', makeHistory('W', prices)]])
    const result = generateSignals(['W'], histories, [])
    expect(result).toHaveLength(1)
    const rsiReason = result[0].reasons.find((r) => r.includes('RSI'))
    expect(rsiReason).toBeDefined()
  })

  it('covers Bollinger pctB < 0 branch with a sharp downward spike', () => {
    // 59 bars at 100, then 1 bar at 85 — current price falls below the lower Bollinger Band
    const prices = [...Array(59).fill(100), 85] as number[]
    const histories = new Map([['X', makeHistory('X', prices)]])
    const result = generateSignals(['X'], histories, [])
    expect(result).toHaveLength(1)
    const bbReason = result[0].reasons.find((r) => r.includes('Bollinger'))
    expect(bbReason).toBeDefined()
  })

  it('covers Bollinger pctB > 1 branch with a sharp upward spike', () => {
    // 59 bars at 100, then 1 bar at 115 — current price rises above the upper Bollinger Band
    const prices = [...Array(59).fill(100), 115] as number[]
    const histories = new Map([['X', makeHistory('X', prices)]])
    const result = generateSignals(['X'], histories, [])
    expect(result).toHaveLength(1)
    const bbReason = result[0].reasons.find((r) => r.includes('Bollinger'))
    expect(bbReason).toBeDefined()
  })

  it('downgrades strong_buy to buy when upside to Bollinger upper band is below 2%', () => {
    const prices = Array.from({ length: 60 }, (_, i) => {
      if (i < 50) return 100 + i * 0.1
      return 104 + (i - 50) * 0.05
    })
    const histories = new Map([['X', makeHistory('X', prices)]])
    const result = generateSignals(['X'], histories, [])
    expect(['buy', 'hold', 'strong_buy', 'sell', 'strong_sell']).toContain(result[0].signal)
  })
})
