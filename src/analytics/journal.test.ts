import { describe, it, expect } from 'vitest'
import { computeStagedPnl } from './journal.js'

describe('computeStagedPnl', () => {
  it('returns null when entry or exit is missing', () => {
    expect(computeStagedPnl(null, 10, 5, null, null)).toBeNull()
    expect(computeStagedPnl(10, null, 5, null, null)).toBeNull()
  })

  it('falls back to (exit − entry) × qty when no partial fired', () => {
    expect(computeStagedPnl(10, 12, 5, null, null)).toBe(10) // 2 × 5
    expect(computeStagedPnl(10, 8, 5, null, null)).toBe(-10) // −2 × 5
  })

  it('blends partial-fill P&L with remainder-fill P&L when partial fired', () => {
    // Open: 10 shares at €10 entry
    // Partial: sold 5 shares at €11.50 (locks +€7.50)
    // Final close: remaining 5 shares at €9 (loses −€5)
    // Total: 7.50 + (−5) = €2.50
    expect(computeStagedPnl(10, 9, 10, 5, 11.5)).toBeCloseTo(2.5, 10)
  })

  it('reproduces the partial=full-qty edge case (partial = whole position)', () => {
    // Defensive: a partial_exit_qty that happens to equal the original qty
    // means remainder = 0; final exit price contributes zero. P&L should be
    // purely from the partial leg.
    expect(computeStagedPnl(10, 7, 5, 5, 12)).toBe(10) // 5 × (12 − 10) + 0
  })

  it('treats partial_exit_qty = 0 as no partial having fired', () => {
    // Zero-qty partial is meaningless — fall through to the single-exit math.
    expect(computeStagedPnl(10, 12, 5, 0, 11)).toBe(10)
  })
})
