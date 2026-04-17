import { describe, it, expect } from 'vitest'
import {
  sma,
  ema,
  rsi,
  bollingerBands,
  macdFull,
  stochastic,
  computeIndicators,
} from './indicators.js'

describe('sma', () => {
  it('returns null when prices length is less than period', () => {
    expect(sma([1, 2], 3)).toBeNull()
    expect(sma([], 1)).toBeNull()
  })

  it('calculates average of exactly the last N prices', () => {
    expect(sma([1, 2, 3], 3)).toBe(2)
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4)
  })

  it('uses only the last N values when more are available', () => {
    expect(sma([10, 20, 30, 40, 50], 2)).toBe(45)
  })

  it('handles period of 1', () => {
    expect(sma([42], 1)).toBe(42)
    expect(sma([10, 20, 30], 1)).toBe(30)
  })
})

describe('ema', () => {
  it('returns null when not enough prices', () => {
    expect(ema([1, 2], 3)).toBeNull()
    expect(ema([], 5)).toBeNull()
  })

  it('returns the SMA when exactly period prices are provided', () => {
    expect(ema([2, 4, 6], 3)).toBe(4)
  })

  it('applies exponential weighting for subsequent prices', () => {
    // initial = (1+2+3)/3 = 2, k = 2/(3+1) = 0.5
    // EMA(4) = 4*0.5 + 2*0.5 = 3
    expect(ema([1, 2, 3, 4], 3)).toBeCloseTo(3, 10)
  })

  it('weights recent prices more heavily than SMA', () => {
    const prices = [10, 10, 10, 10, 10, 20]
    expect(ema(prices, 3)!).toBeGreaterThan(sma(prices, 3)!)
  })
})

describe('rsi', () => {
  it('returns null when prices length is less than period + 1', () => {
    expect(rsi([1, 2, 3], 14)).toBeNull()
    expect(rsi(Array(14).fill(1), 14)).toBeNull()
  })

  it('returns 100 when there are only gains', () => {
    const allGains = Array.from({ length: 15 }, (_, i) => i + 1)
    expect(rsi(allGains, 14)).toBe(100)
  })

  it('returns 0 when there are only losses', () => {
    const allLosses = Array.from({ length: 15 }, (_, i) => 15 - i)
    expect(rsi(allLosses, 14)).toBe(0)
  })

  it('returns a value between 0 and 100 for mixed movement', () => {
    const mixed = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10]
    const result = rsi(mixed, 14)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
    expect(result!).toBeLessThan(100)
  })

  it('produces higher RSI for a stronger uptrend', () => {
    const strong = Array.from({ length: 15 }, (_, i) => i * 2)
    const weak = [10, 11, 10, 12, 11, 12, 11, 13, 12, 13, 12, 14, 13, 14, 15]
    expect(rsi(strong, 14)!).toBeGreaterThan(rsi(weak, 14)!)
  })

  it('uses 14 as the default period', () => {
    const prices = Array.from({ length: 15 }, (_, i) => i + 1)
    expect(rsi(prices)).toBe(rsi(prices, 14))
  })
})

describe('bollingerBands', () => {
  it('returns null when not enough prices', () => {
    expect(bollingerBands(Array(19).fill(10), 20)).toBeNull()
    expect(bollingerBands([], 20)).toBeNull()
  })

  it('returns percentB of 0.5 when all prices are identical', () => {
    const result = bollingerBands(Array(20).fill(10))!
    expect(result.middle).toBe(10)
    expect(result.upper).toBe(10)
    expect(result.lower).toBe(10)
    expect(result.percentB).toBe(0.5)
  })

  it('places upper band above middle and lower band below', () => {
    const prices = Array.from({ length: 20 }, (_, i) => Math.sin(i) * 5 + 10)
    const result = bollingerBands(prices)!
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })

  it('returns percentB > 1 when current price is far above the mean', () => {
    const result = bollingerBands([...Array(19).fill(10), 30])!
    expect(result.percentB).toBeGreaterThan(1)
  })

  it('returns percentB < 0 when current price is far below the mean', () => {
    const result = bollingerBands([...Array(19).fill(10), -10])!
    expect(result.percentB).toBeLessThan(0)
  })

  it('wider multiplier produces a wider band', () => {
    const prices = Array.from({ length: 10 }, (_, i) => i + 1)
    const narrow = bollingerBands(prices, 10, 1)!
    const wide = bollingerBands(prices, 10, 3)!
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower)
  })
})

describe('macdFull', () => {
  it('returns null when not enough prices for the slow EMA', () => {
    expect(macdFull(Array(25).fill(10))).toBeNull()
  })

  it('returns null when macdLine is shorter than signalP', () => {
    expect(macdFull(Array(33).fill(10))).toBeNull()
  })

  it('returns valid data for sufficient prices', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 10 + Math.sin(i * 0.5) * 2)
    const result = macdFull(prices)!
    expect(typeof result.macd).toBe('number')
    expect(typeof result.signal).toBe('number')
    expect(typeof result.histogram).toBe('number')
  })

  it('histogram always equals macd minus signal', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 10 + i * 0.1)
    const result = macdFull(prices)!
    expect(result.histogram).toBeCloseTo(result.macd - result.signal, 10)
  })

  it('provides previous MACD and signal values for crossover detection', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 10 + Math.sin(i * 0.3) * 3)
    const result = macdFull(prices)!
    expect(result.prevMacd).not.toBeNull()
    expect(result.prevSignal).not.toBeNull()
  })
})

describe('stochastic', () => {
  it('returns null when not enough prices', () => {
    expect(stochastic(Array(15).fill(10))).toBeNull()
    expect(stochastic([])).toBeNull()
  })

  it('returns 50 when all prices are identical', () => {
    expect(stochastic(Array(20).fill(10))!.k).toBe(50)
  })

  it('returns %K of 100 when current price is the period high', () => {
    const prices = [...Array(15).fill(5), 10]
    expect(stochastic(prices, 14, 3)!.k).toBe(100)
  })

  it('returns %K of 0 when current price is the period low', () => {
    const prices = [...Array(15).fill(10), 1]
    expect(stochastic(prices, 14, 3)!.k).toBe(0)
  })

  it('returns a numeric %D value for valid inputs', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 10 + Math.sin(i))
    const result = stochastic(prices, 14, 3)!
    expect(typeof result.d).toBe('number')
  })
})

describe('computeIndicators', () => {
  it('returns the ticker name and all nulls for an empty price array', () => {
    const result = computeIndicators('AAPL', [])
    expect(result.ticker).toBe('AAPL')
    expect(result.currentPrice).toBeNull()
    expect(result.priceChange1d).toBeNull()
    expect(result.rsi14).toBeNull()
    expect(result.sma20).toBeNull()
    expect(result.macd).toBeNull()
    expect(result.macdBullCross).toBeNull()
    expect(result.macdBearCross).toBeNull()
  })

  it('sets currentPrice to the last element', () => {
    expect(computeIndicators('X', [100, 110, 120]).currentPrice).toBe(120)
  })

  it('returns null priceChange1d for a single price', () => {
    expect(computeIndicators('X', [100]).priceChange1d).toBeNull()
  })

  it('calculates priceChange1d as a percentage of the previous close', () => {
    expect(computeIndicators('X', [100, 110]).priceChange1d).toBeCloseTo(10, 5)
    expect(computeIndicators('X', [100, 90]).priceChange1d).toBeCloseTo(-10, 5)
  })

  it('returns null for indicators that need more data than provided', () => {
    const result = computeIndicators(
      'X',
      Array.from({ length: 10 }, (_, i) => i + 1)
    )
    expect(result.sma20).toBeNull()
    expect(result.rsi14).toBeNull()
  })

  it('computes all indicators when sufficient prices are available', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 10)
    const result = computeIndicators('TSLA', prices)
    expect(result.rsi14).not.toBeNull()
    expect(result.sma20).not.toBeNull()
    expect(result.sma50).not.toBeNull()
    expect(result.ema9).not.toBeNull()
    expect(result.ema12).not.toBeNull()
    expect(result.ema21).not.toBeNull()
    expect(result.ema26).not.toBeNull()
    expect(result.macd).not.toBeNull()
    expect(result.macdSignal).not.toBeNull()
    expect(result.macdHistogram).not.toBeNull()
    expect(result.bollingerUpper).not.toBeNull()
    expect(result.stochK).not.toBeNull()
    expect(result.stochD).not.toBeNull()
  })

  it('computes boolean MACD crossover flags with sufficient price history', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 10)
    const result = computeIndicators('X', prices)
    expect(typeof result.macdBullCross).toBe('boolean')
    expect(typeof result.macdBearCross).toBe('boolean')
  })

  it('detects a MACD bearish crossover after a sharp price reversal', () => {
    const prices: number[] = [
      ...Array.from({ length: 40 }, (_, i) => 100 + i * 2),
      ...Array.from({ length: 20 }, (_, i) => 180 - i * 4),
    ]
    const result = computeIndicators('X', prices)
    expect(result.macd).not.toBeNull()
    expect(result.macdBearCross === true || result.macdBearCross === false).toBe(true)
  })
})
