import { describe, it, expect } from 'vitest'
import {
  isMarketOpen,
  isMarketOpenSpec,
  nextOpenMs,
  nextOpenMsSpec,
  msUntilCloseSpec,
  nyseTradingDateStr,
  tradingDateStr,
} from './scheduler.js'
import { NYSE, XETRA } from '../markets/registry.js'

// A Tuesday in late May — well outside any holiday window for both markets.
// 2026-05-19 was a Tuesday.
const TUESDAY = '2026-05-19'

describe('scheduler — NYSE', () => {
  it('is open at 10:00 ET on a Tuesday', () => {
    // 10:00 EDT = 14:00 UTC in May (DST active)
    const t = new Date(`${TUESDAY}T14:00:00Z`)
    expect(isMarketOpenSpec(NYSE, t)).toBe(true)
    expect(isMarketOpen(t)).toBe(true)
  })

  it('is closed at 09:00 ET (pre-open)', () => {
    const t = new Date(`${TUESDAY}T13:00:00Z`) // 9:00 EDT
    expect(isMarketOpenSpec(NYSE, t)).toBe(false)
  })

  it('is closed at 16:00 ET (after close — exclusive)', () => {
    const t = new Date(`${TUESDAY}T20:00:00Z`) // 16:00 EDT
    expect(isMarketOpenSpec(NYSE, t)).toBe(false)
  })

  it('is closed on Christmas (NYSE holiday)', () => {
    const t = new Date('2026-12-25T15:00:00Z') // noon ET on a Friday
    expect(isMarketOpenSpec(NYSE, t)).toBe(false)
  })

  it('is closed on a Saturday', () => {
    const t = new Date('2026-05-23T15:00:00Z') // Saturday
    expect(isMarketOpenSpec(NYSE, t)).toBe(false)
  })

  it('nyseTradingDateStr returns date in NY timezone', () => {
    // 02:00 UTC Tue = 22:00 ET Mon (EDT = UTC-4 in May)
    const monday = new Date(`${TUESDAY}T02:00:00Z`)
    expect(nyseTradingDateStr(monday)).toBe('2026-05-18')
    const tuesday = new Date(`${TUESDAY}T14:00:00Z`)
    expect(nyseTradingDateStr(tuesday)).toBe(TUESDAY)
  })

  it('nextOpenMs is positive and < 1 day when called before today open', () => {
    const t = new Date(`${TUESDAY}T08:00:00Z`) // ~5h before NYSE open
    const ms = nextOpenMs(t)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThan(24 * 60 * 60 * 1000)
  })

  it('nextOpenMsSpec rolls over weekend correctly', () => {
    const friday = new Date('2026-05-22T22:00:00Z') // Fri 18:00 ET (after close)
    const ms = nextOpenMsSpec(NYSE, friday)
    // Should land on Monday 2026-05-25 (Memorial Day holiday → Tuesday 26th)
    // 2026-05-25 is Memorial Day → next open is Tue 2026-05-26 13:30 UTC
    const expectedNextOpen = new Date('2026-05-26T13:30:00Z').getTime()
    const actualNextOpen = friday.getTime() + ms
    expect(Math.abs(actualNextOpen - expectedNextOpen)).toBeLessThan(60_000)
  })
})

describe('scheduler — XETRA', () => {
  it('is open at 11:00 CET on a Tuesday', () => {
    // 11:00 CEST = 09:00 UTC in May
    const t = new Date(`${TUESDAY}T09:00:00Z`)
    expect(isMarketOpenSpec(XETRA, t)).toBe(true)
  })

  it('is closed at 08:30 CET (pre-open)', () => {
    const t = new Date(`${TUESDAY}T06:30:00Z`) // 08:30 CEST
    expect(isMarketOpenSpec(XETRA, t)).toBe(false)
  })

  it('is closed at 17:30 CET (after close — exclusive)', () => {
    const t = new Date(`${TUESDAY}T15:30:00Z`) // 17:30 CEST
    expect(isMarketOpenSpec(XETRA, t)).toBe(false)
  })

  it('is open at 17:29 CET (last minute)', () => {
    const t = new Date(`${TUESDAY}T15:29:00Z`) // 17:29 CEST
    expect(isMarketOpenSpec(XETRA, t)).toBe(true)
  })

  it('is closed on May 1 (Labour Day — Xetra holiday)', () => {
    const t = new Date('2026-05-01T10:00:00Z') // Friday at noon CEST
    expect(isMarketOpenSpec(XETRA, t)).toBe(false)
  })

  it('is closed on Dec 24 (half-day treated as closed)', () => {
    const t = new Date('2026-12-24T10:00:00Z')
    expect(isMarketOpenSpec(XETRA, t)).toBe(false)
  })

  it('tradingDateStr uses Berlin TZ', () => {
    // 23:30 UTC = 00:30 next day Berlin in winter (CET = UTC+1)
    const t = new Date('2026-12-15T23:30:00Z')
    expect(tradingDateStr(XETRA, t)).toBe('2026-12-16')
  })

  it('msUntilCloseSpec is positive while open', () => {
    const t = new Date(`${TUESDAY}T10:00:00Z`) // 12:00 CEST
    const ms = msUntilCloseSpec(XETRA, t)
    // Close at 17:30 CEST = 15:30 UTC, so 5.5h away
    expect(ms).toBeGreaterThan(5 * 60 * 60 * 1000)
    expect(ms).toBeLessThan(6 * 60 * 60 * 1000)
  })

  it('NYSE and XETRA are both open during overlap window', () => {
    // 14:35 UTC on a Tuesday in May:
    //   NYSE: 10:35 EDT — open
    //   XETRA: 16:35 CEST — open
    const t = new Date(`${TUESDAY}T14:35:00Z`)
    expect(isMarketOpenSpec(NYSE, t)).toBe(true)
    expect(isMarketOpenSpec(XETRA, t)).toBe(true)
  })

  it('XETRA closed but NYSE open at 16:00 UTC', () => {
    // 16:00 UTC = 18:00 CEST (Xetra closed) = 12:00 EDT (NYSE open)
    const t = new Date(`${TUESDAY}T16:00:00Z`)
    expect(isMarketOpenSpec(XETRA, t)).toBe(false)
    expect(isMarketOpenSpec(NYSE, t)).toBe(true)
  })
})
