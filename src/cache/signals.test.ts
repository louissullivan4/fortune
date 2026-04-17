import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getCachedSignals, setCachedSignals, isCacheFresh, clearCache } from './signals.js'
import type { TickerSignal } from '../strategy/signals.js'

function mockSignals(count = 2): TickerSignal[] {
  return Array.from({ length: count }, (_, i) => ({
    ticker: `T${i}`,
    signal: 'hold' as const,
    indicators: {
      ticker: `T${i}`,
      rsi14: null,
      sma20: null,
      sma50: null,
      ema9: null,
      ema12: null,
      ema21: null,
      ema26: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      macdBullCross: null,
      macdBearCross: null,
      bollingerUpper: null,
      bollingerMiddle: null,
      bollingerLower: null,
      bollingerPctB: null,
      stochK: null,
      stochD: null,
      currentPrice: 100,
      priceChange1d: null,
    },
    reasons: [],
    heldPosition: null,
  }))
}

describe('signal cache', () => {
  beforeEach(() => {
    clearCache('user-a')
    clearCache('user-b')
  })

  describe('getCachedSignals', () => {
    it('returns null when no entry exists for the user', () => {
      expect(getCachedSignals('user-a')).toBeNull()
    })

    it('returns null for an unknown user even when other users have cache', () => {
      setCachedSignals('user-b', mockSignals())
      expect(getCachedSignals('user-a')).toBeNull()
    })

    it('returns the stored data after setCachedSignals', () => {
      const signals = mockSignals(3)
      setCachedSignals('user-a', signals)
      expect(getCachedSignals('user-a')!.data).toEqual(signals)
    })

    it('includes a valid ISO timestamp in computedAt', () => {
      setCachedSignals('user-a', mockSignals())
      const { computedAt } = getCachedSignals('user-a')!
      expect(typeof computedAt).toBe('string')
      expect(new Date(computedAt).getTime()).not.toBeNaN()
    })
  })

  describe('setCachedSignals', () => {
    it('overwrites a previous entry for the same user', () => {
      setCachedSignals('user-a', mockSignals(2))
      const fresh = mockSignals(5)
      setCachedSignals('user-a', fresh)
      expect(getCachedSignals('user-a')!.data).toEqual(fresh)
    })

    it('does not affect other users', () => {
      const a = mockSignals(2)
      const b = mockSignals(3)
      setCachedSignals('user-a', a)
      setCachedSignals('user-b', b)
      expect(getCachedSignals('user-a')!.data).toEqual(a)
      expect(getCachedSignals('user-b')!.data).toEqual(b)
    })
  })

  describe('isCacheFresh', () => {
    it('returns false when no cache exists', () => {
      expect(isCacheFresh('user-a')).toBe(false)
    })

    it('returns true immediately after setting cache', () => {
      setCachedSignals('user-a', mockSignals())
      expect(isCacheFresh('user-a')).toBe(true)
    })

    it('returns false after the 5-minute TTL has elapsed', () => {
      vi.useFakeTimers()
      setCachedSignals('user-a', mockSignals())
      vi.advanceTimersByTime(6 * 60 * 1000)
      expect(isCacheFresh('user-a')).toBe(false)
      vi.useRealTimers()
    })

    it('returns true when less than 5 minutes have passed', () => {
      vi.useFakeTimers()
      setCachedSignals('user-a', mockSignals())
      vi.advanceTimersByTime(4 * 60 * 1000)
      expect(isCacheFresh('user-a')).toBe(true)
      vi.useRealTimers()
    })
  })

  describe('clearCache', () => {
    it('removes the entry for the specified user', () => {
      setCachedSignals('user-a', mockSignals())
      clearCache('user-a')
      expect(getCachedSignals('user-a')).toBeNull()
    })

    it('does not remove entries for other users', () => {
      setCachedSignals('user-a', mockSignals())
      setCachedSignals('user-b', mockSignals())
      clearCache('user-a')
      expect(getCachedSignals('user-b')).not.toBeNull()
    })

    it('does not throw when called for a user with no cache', () => {
      expect(() => clearCache('nonexistent-user')).not.toThrow()
    })
  })
})
