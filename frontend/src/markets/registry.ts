// Frontend mirror of the backend MarketSpec — kept small (no holidays, those
// come from the backend). The MarketClock checks open/close locally so the
// status indicator updates every second without a server roundtrip.

export interface MarketSpec {
  code: string
  displayName: string
  timezone: string
  currency: string
  openMinutesLocal: number
  closeMinutesLocal: number
  /** Holidays as 'YYYY-MM-DD' in market-local timezone. */
  holidays: ReadonlySet<string>
}

const NYSE_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
])

const XETRA_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-04-18',
  '2025-04-21',
  '2025-05-01',
  '2025-12-24',
  '2025-12-25',
  '2025-12-26',
  '2025-12-31',
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-01',
  '2026-12-24',
  '2026-12-25',
  '2026-12-28',
  '2026-12-31',
  '2027-01-01',
  '2027-03-26',
  '2027-03-29',
  '2027-05-01',
  '2027-12-24',
  '2027-12-27',
  '2027-12-28',
  '2027-12-31',
])

export const NYSE: MarketSpec = {
  code: 'NYSE',
  displayName: 'NYSE',
  timezone: 'America/New_York',
  currency: 'USD',
  openMinutesLocal: 9 * 60 + 30,
  closeMinutesLocal: 16 * 60,
  holidays: NYSE_HOLIDAYS,
}

export const XETRA: MarketSpec = {
  code: 'XETRA',
  displayName: 'Xetra',
  timezone: 'Europe/Berlin',
  currency: 'EUR',
  openMinutesLocal: 9 * 60,
  closeMinutesLocal: 17 * 60 + 30,
  holidays: XETRA_HOLIDAYS,
}

export const MARKETS: Record<string, MarketSpec> = { NYSE, XETRA }

export const MARKET_CODES = Object.keys(MARKETS)

export function getMarketSpec(code: string): MarketSpec {
  const spec = MARKETS[code]
  if (!spec) throw new Error(`Unknown market: ${code}`)
  return spec
}

// ── Open/close detection using Intl (parameterized on spec) ────────────────

function localDateString(spec: MarketSpec, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: spec.timezone }).format(date)
}

function localMinutesOfDay(spec: MarketSpec, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: spec.timezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function localIsWeekday(spec: MarketSpec, date: Date): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: spec.timezone,
    weekday: 'short',
  }).format(date)
  return day !== 'Sun' && day !== 'Sat'
}

function localIsHoliday(spec: MarketSpec, date: Date): boolean {
  return spec.holidays.has(localDateString(spec, date))
}

function localBoundaryUtcTime(spec: MarketSpec, date: Date, mins: number): Date {
  const dateStr = localDateString(spec, date)
  const ref = new Date(`${dateStr}T17:00:00Z`)
  const refLocalHour =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: spec.timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(ref)
        .find((p) => p.type === 'hour')?.value ?? '13'
    ) % 24
  const offsetHours = 17 - refLocalHour
  const sign = offsetHours >= 0 ? '-' : '+'
  const absOff = Math.abs(offsetHours)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hh = pad(Math.floor(mins / 60))
  const mm = pad(mins % 60)
  return new Date(`${dateStr}T${hh}:${mm}:00${sign}${pad(absOff)}:00`)
}

export function isMarketOpen(spec: MarketSpec, now: Date = new Date()): boolean {
  if (!localIsWeekday(spec, now) || localIsHoliday(spec, now)) return false
  const mins = localMinutesOfDay(spec, now)
  return mins >= spec.openMinutesLocal && mins < spec.closeMinutesLocal
}

export function msUntilOpen(spec: MarketSpec, now: Date = new Date()): number {
  if (localIsWeekday(spec, now) && !localIsHoliday(spec, now)) {
    const openTime = localBoundaryUtcTime(spec, now, spec.openMinutesLocal)
    if (openTime.getTime() > now.getTime()) return openTime.getTime() - now.getTime()
  }
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0)
  )
  while (!localIsWeekday(spec, next) || localIsHoliday(spec, next))
    next.setUTCDate(next.getUTCDate() + 1)
  return localBoundaryUtcTime(spec, next, spec.openMinutesLocal).getTime() - now.getTime()
}

export function msUntilClose(spec: MarketSpec, now: Date = new Date()): number {
  return localBoundaryUtcTime(spec, now, spec.closeMinutesLocal).getTime() - now.getTime()
}
