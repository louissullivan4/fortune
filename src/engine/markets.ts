// Central registry of tradable exchanges. Extensible by adding an entry to
// EXCHANGES below — rest of the engine, API and frontend read from this map.
//
// Active-hour windows (`activeFrom`/`activeTo`) are stored and displayed in
// the *user's* timezone (Ireland), because that matches how the user thinks
// about "when is NYSE open for me?". The market's own IANA tz is still used
// for the trading-day / holiday calendar check. DST differences between the
// two tzs are tolerated — defaults line up year-round since Ireland and both
// markets share synchronised DST transitions for the majority of the year.

export const USER_TZ = 'Europe/Dublin'

export type ExchangeCode = 'NYSE' | 'XETR'

export interface ExchangeMeta {
  code: ExchangeCode
  name: string
  shortName: string
  timezone: string
  currency: string
  /** Full session open, local wall-clock, HH:MM. */
  defaultOpen: string
  /** Full session close, local wall-clock, HH:MM. */
  defaultClose: string
  /** Weekday short-names that are trading days. */
  tradingDays: ReadonlySet<string>
  /** YYYY-MM-DD (market-local) holidays. */
  holidays: ReadonlySet<string>
}

const MON_FRI = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

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

// Deutsche Börse XETRA — fixed holidays + Good Friday / Easter Monday +
// May 1 + Christmas Eve / Christmas Day / Boxing Day / New Year's Eve.
// Source: https://www.xetra.com/xetra-en/trading/trading-calendar-and-trading-hours
const XETR_HOLIDAYS = new Set([
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

export const EXCHANGES: Record<ExchangeCode, ExchangeMeta> = {
  NYSE: {
    code: 'NYSE',
    name: 'New York Stock Exchange',
    shortName: 'NYSE',
    timezone: 'America/New_York',
    currency: 'USD',
    // 09:30–16:00 ET == 14:30–21:00 Europe/Dublin year-round.
    defaultOpen: '14:30',
    defaultClose: '21:00',
    tradingDays: MON_FRI,
    holidays: NYSE_HOLIDAYS,
  },
  XETR: {
    code: 'XETR',
    name: 'Deutsche Börse XETRA',
    shortName: 'XETRA',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    // 09:00–17:30 CET/CEST == 08:00–16:30 Europe/Dublin year-round.
    defaultOpen: '08:00',
    defaultClose: '16:30',
    tradingDays: MON_FRI,
    holidays: XETR_HOLIDAYS,
  },
}

export const EXCHANGE_CODES: ExchangeCode[] = Object.keys(EXCHANGES) as ExchangeCode[]

export function getExchange(code: ExchangeCode): ExchangeMeta {
  return EXCHANGES[code]
}

// ── Time helpers ──────────────────────────────────────────────────────────

/** ISO calendar date (YYYY-MM-DD) for `date` as seen in `tz`. */
function localDateString(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date)
}

function localMinutesOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function localWeekday(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
}

function isTradingDay(date: Date, meta: ExchangeMeta): boolean {
  const day = localWeekday(date, meta.timezone)
  if (!meta.tradingDays.has(day)) return false
  return !meta.holidays.has(localDateString(date, meta.timezone))
}

/** Find the UTC offset (hours) for a given date+tz. */
function offsetHours(date: Date, tz: string): number {
  // "en-US" with hour '2-digit' gives the hour in the target tz.
  // Compare against an anchor UTC hour to derive the offset for that instant.
  const ref = new Date(date)
  const tzHour =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(ref)
        .find((p) => p.type === 'hour')?.value ?? '0'
    ) % 24
  const utcHour = ref.getUTCHours()
  let diff = tzHour - utcHour
  if (diff > 12) diff -= 24
  if (diff < -12) diff += 24
  return diff
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, '0')
  const m = (mins % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

/** Build a UTC Date for the given HH:MM on a specific calendar date in `tz`. */
function tzHhmmToUtc(dateStr: string, tz: string, hhmm: string): Date {
  const offs = offsetHours(new Date(`${dateStr}T12:00:00Z`), tz)
  const sign = offs >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  return new Date(`${dateStr}T${hhmm}:00${sign}${pad(offs)}:00`)
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Is the exchange open *right now*, using the user's active-hour window
 * (or the default session if no window supplied)?
 *
 * Trading day (weekend/holiday) is checked in the market's tz. Window bounds
 * are checked in the user tz.
 */
export function isMarketOpen(
  exchange: ExchangeCode,
  now: Date = new Date(),
  window?: { from: string; to: string }
): boolean {
  const meta = getExchange(exchange)
  if (!isTradingDay(now, meta)) return false
  const from = hhmmToMinutes(window?.from ?? meta.defaultOpen)
  const to = hhmmToMinutes(window?.to ?? meta.defaultClose)
  const mins = localMinutesOfDay(now, USER_TZ)
  return mins >= from && mins < to
}

/** Milliseconds until the exchange next opens (0 if already open). */
export function nextOpenMs(
  exchange: ExchangeCode,
  now: Date = new Date(),
  window?: { from: string; to: string }
): number {
  if (isMarketOpen(exchange, now, window)) return 0
  const meta = getExchange(exchange)
  const openHhmm = window?.from ?? meta.defaultOpen

  // Today: is today a trading day (market tz) and are we still before the
  // window opens (user tz)?
  if (isTradingDay(now, meta)) {
    const openToday = tzHhmmToUtc(localDateString(now, USER_TZ), USER_TZ, openHhmm)
    if (openToday.getTime() > now.getTime()) return openToday.getTime() - now.getTime()
  }

  // Advance day-by-day until the next market trading day. User-local date for
  // the window is aligned with that day.
  const cursor = new Date(now)
  for (let i = 0; i < 14; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isTradingDay(cursor, meta)) {
      const openNext = tzHhmmToUtc(localDateString(cursor, USER_TZ), USER_TZ, openHhmm)
      return openNext.getTime() - now.getTime()
    }
  }
  throw new Error(`${exchange}: no trading day within 14 days — likely misconfigured`)
}

/** Milliseconds until the exchange's configured close. Returns 0 if already closed. */
export function msUntilClose(
  exchange: ExchangeCode,
  now: Date = new Date(),
  window?: { from: string; to: string }
): number {
  if (!isMarketOpen(exchange, now, window)) return 0
  const closeHhmm = window?.to ?? getExchange(exchange).defaultClose
  const closeToday = tzHhmmToUtc(localDateString(now, USER_TZ), USER_TZ, closeHhmm)
  return Math.max(0, closeToday.getTime() - now.getTime())
}

/** Default full session window for the UI's "Apply suggested" button. */
export function defaultWindow(exchange: ExchangeCode): { from: string; to: string } {
  const meta = getExchange(exchange)
  return { from: meta.defaultOpen, to: meta.defaultClose }
}

export { hhmmToMinutes, minutesToHhmm }
