import { describe, it, expect } from 'vitest'
import { isMarketOpen, nextOpenMs, msUntilClose, defaultWindow } from './markets.js'

// Windows are expressed in Europe/Dublin wall-clock. Trading-day/holiday
// calendar uses the market's own tz.

describe('markets — NYSE (hours as Ireland local)', () => {
  it('is open at 15:00 Dublin (= 10:00 ET) on a trading Tuesday', () => {
    const t = new Date('2026-07-14T14:00:00Z') // 15:00 IST
    expect(isMarketOpen('NYSE', t)).toBe(true)
  })

  it('is closed at 14:00 Dublin, before the 14:30 open', () => {
    const t = new Date('2026-07-14T13:00:00Z') // 14:00 IST
    expect(isMarketOpen('NYSE', t)).toBe(false)
  })

  it('is closed on weekends', () => {
    const t = new Date('2026-07-11T15:00:00Z') // Saturday
    expect(isMarketOpen('NYSE', t)).toBe(false)
  })

  it('is closed on NYSE holiday 2026-07-03', () => {
    const t = new Date('2026-07-03T15:00:00Z')
    expect(isMarketOpen('NYSE', t)).toBe(false)
  })

  it('msUntilClose is ~30 min at 20:30 Dublin (close 21:00)', () => {
    const t = new Date('2026-07-14T19:30:00Z') // 20:30 IST
    expect(msUntilClose('NYSE', t)).toBe(30 * 60 * 1000)
  })

  it('nextOpenMs before 14:30 Dublin returns same-day open', () => {
    const t = new Date('2026-07-14T12:00:00Z') // 13:00 IST
    const ms = nextOpenMs('NYSE', t)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(2 * 60 * 60 * 1000)
  })

  it('nextOpenMs after Friday close rolls to Monday 14:30 Dublin', () => {
    const fri = new Date('2026-07-17T22:00:00Z') // Friday 23:00 IST
    const ms = nextOpenMs('NYSE', fri)
    // Monday 14:30 IST = 2026-07-20T13:30:00Z
    const expected = new Date('2026-07-20T13:30:00Z').getTime() - fri.getTime()
    expect(ms).toBe(expected)
  })
})

describe('markets — XETR (hours as Ireland local)', () => {
  it('is open at 09:00 Dublin (= 10:00 CET) on a trading Tuesday, winter', () => {
    const t = new Date('2026-11-10T09:00:00Z') // 09:00 GMT
    expect(isMarketOpen('XETR', t)).toBe(true)
  })

  it('is closed at 07:00 Dublin, before the 08:00 open', () => {
    const t = new Date('2026-11-10T07:00:00Z') // 07:00 GMT
    expect(isMarketOpen('XETR', t)).toBe(false)
  })

  it('is open at 09:00 Dublin (= 10:00 CEST) on a summer Monday', () => {
    const t = new Date('2026-07-13T08:00:00Z') // 09:00 IST
    expect(isMarketOpen('XETR', t)).toBe(true)
  })

  it('is closed on XETR holiday 2026-05-01', () => {
    const t = new Date('2026-05-01T10:00:00Z')
    expect(isMarketOpen('XETR', t)).toBe(false)
  })

  it('msUntilClose is ~30 min at 16:00 Dublin (close 16:30)', () => {
    const t = new Date('2026-11-10T16:00:00Z') // 16:00 GMT
    expect(msUntilClose('XETR', t)).toBe(30 * 60 * 1000)
  })
})

describe('markets — custom window narrowing', () => {
  it('honours a user-defined narrower window (Dublin local)', () => {
    // XETR default 08:00–16:30 Dublin. Narrow to 10:00–12:00 Dublin.
    const ten = new Date('2026-11-10T10:00:00Z') // 10:00 GMT
    const eleven = new Date('2026-11-10T11:00:00Z') // 11:00 GMT
    const noon = new Date('2026-11-10T12:00:00Z') // 12:00 GMT — end-exclusive
    expect(isMarketOpen('XETR', ten, { from: '10:00', to: '12:00' })).toBe(true)
    expect(isMarketOpen('XETR', eleven, { from: '10:00', to: '12:00' })).toBe(true)
    expect(isMarketOpen('XETR', noon, { from: '10:00', to: '12:00' })).toBe(false)
  })
})

describe('markets — defaults (Ireland local)', () => {
  it('exposes Irish local defaults for both exchanges', () => {
    expect(defaultWindow('NYSE')).toEqual({ from: '14:30', to: '21:00' })
    expect(defaultWindow('XETR')).toEqual({ from: '08:00', to: '16:30' })
  })
})
