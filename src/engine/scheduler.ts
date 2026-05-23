import { type MarketSpec, NYSE } from '../markets/registry.js'

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

/**
 * Compute the UTC `Date` corresponding to a local-time minute-of-day boundary
 * on the same trading day as `date` (interpreted in spec.timezone). Used to
 * compute milliseconds-until-open / -until-close without a DST-aware library.
 */
function localBoundaryUtcTime(spec: MarketSpec, date: Date, localMinutesOfDay: number): Date {
  const dateStr = localDateString(spec, date)
  // Find the spec.timezone UTC offset for this date by formatting a noon-UTC
  // reference and reading back the local hour. Works across DST boundaries
  // because the formatter uses the right offset for the supplied date.
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
  const hh = pad(Math.floor(localMinutesOfDay / 60))
  const mm = pad(localMinutesOfDay % 60)
  return new Date(`${dateStr}T${hh}:${mm}:00${sign}${pad(absOff)}:00`)
}

/** YYYY-MM-DD trading-date identifier in the market's local timezone. */
export function tradingDateStr(spec: MarketSpec, date: Date = new Date()): string {
  return localDateString(spec, date)
}

/** True when the given market is currently in its regular trading hours. */
export function isMarketOpenSpec(spec: MarketSpec, now: Date = new Date()): boolean {
  if (!localIsWeekday(spec, now) || localIsHoliday(spec, now)) return false
  const mins = localMinutesOfDay(spec, now)
  return mins >= spec.openMinutesLocal && mins < spec.closeMinutesLocal
}

/** Milliseconds from `now` until the next time the market opens. */
export function nextOpenMsSpec(spec: MarketSpec, now: Date = new Date()): number {
  if (localIsWeekday(spec, now) && !localIsHoliday(spec, now)) {
    const openTime = localBoundaryUtcTime(spec, now, spec.openMinutesLocal)
    if (openTime.getTime() > now.getTime()) {
      return openTime.getTime() - now.getTime()
    }
  }

  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0)
  )
  while (!localIsWeekday(spec, next) || localIsHoliday(spec, next)) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return localBoundaryUtcTime(spec, next, spec.openMinutesLocal).getTime() - now.getTime()
}

/** Milliseconds from `now` until the market closes today (positive when open). */
export function msUntilCloseSpec(spec: MarketSpec, now: Date = new Date()): number {
  return localBoundaryUtcTime(spec, now, spec.closeMinutesLocal).getTime() - now.getTime()
}

// ── Backwards-compat NYSE wrappers ────────────────────────────────────────
// Existing callers (routes, MarketClock duplicate) still use the zero-arg
// shape. Keep them functioning until Phase 5 rewires the frontend and routes.

/** NYSE-only convenience wrapper. Prefer `isMarketOpenSpec(spec)`. */
export function isMarketOpen(now: Date = new Date()): boolean {
  return isMarketOpenSpec(NYSE, now)
}

/** NYSE-only convenience wrapper. Prefer `nextOpenMsSpec(spec)`. */
export function nextOpenMs(now: Date = new Date()): number {
  return nextOpenMsSpec(NYSE, now)
}

/** NYSE-only convenience wrapper. Prefer `tradingDateStr(spec)`. */
export function nyseTradingDateStr(date: Date = new Date()): string {
  return tradingDateStr(NYSE, date)
}
