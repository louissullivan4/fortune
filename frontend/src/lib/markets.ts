// Mirror of backend/src/engine/markets.ts — kept in sync manually.
// Frontend uses this for the MarketClock, sidebar, Config page previews.
// Windows are Europe/Dublin wall-clock; trading-day check uses the market tz.

export const USER_TZ = 'Europe/Dublin'

export type ExchangeCode = 'NYSE' | 'XETR'

export interface ExchangeMeta {
  code: ExchangeCode
  name: string
  shortName: string
  timezone: string
  currency: string
  defaultOpen: string
  defaultClose: string
  tradingDays: ReadonlySet<string>
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
    // 09:30–16:00 ET == 14:30–21:00 Europe/Dublin
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
    // 09:00–17:30 CET/CEST == 08:00–16:30 Europe/Dublin
    defaultOpen: '08:00',
    defaultClose: '16:30',
    tradingDays: MON_FRI,
    holidays: XETR_HOLIDAYS,
  },
}

export const EXCHANGE_CODES: ExchangeCode[] = Object.keys(EXCHANGES) as ExchangeCode[]

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
  return (
    meta.tradingDays.has(localWeekday(date, meta.timezone)) &&
    !meta.holidays.has(localDateString(date, meta.timezone))
  )
}

function offsetHours(date: Date, tz: string): number {
  const tzHour =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .find((p) => p.type === 'hour')?.value ?? '0'
    ) % 24
  const utcHour = date.getUTCHours()
  let diff = tzHour - utcHour
  if (diff > 12) diff -= 24
  if (diff < -12) diff += 24
  return diff
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function tzHhmmToUtc(dateStr: string, tz: string, hhmm: string): Date {
  const offs = offsetHours(new Date(`${dateStr}T12:00:00Z`), tz)
  const sign = offs >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  return new Date(`${dateStr}T${hhmm}:00${sign}${pad(offs)}:00`)
}

export interface MarketWindow {
  exchange: ExchangeCode
  activeFrom: string
  activeTo: string
  enabled: boolean
}

export function isMarketOpen(exchange: ExchangeCode, now: Date, window?: MarketWindow): boolean {
  const meta = EXCHANGES[exchange]
  if (!isTradingDay(now, meta)) return false
  const from = hhmmToMinutes(window?.activeFrom ?? meta.defaultOpen)
  const to = hhmmToMinutes(window?.activeTo ?? meta.defaultClose)
  const mins = localMinutesOfDay(now, USER_TZ)
  return mins >= from && mins < to
}

export function nextOpenMs(exchange: ExchangeCode, now: Date, window?: MarketWindow): number {
  if (isMarketOpen(exchange, now, window)) return 0
  const meta = EXCHANGES[exchange]
  const open = window?.activeFrom ?? meta.defaultOpen
  if (isTradingDay(now, meta)) {
    const today = tzHhmmToUtc(localDateString(now, USER_TZ), USER_TZ, open)
    if (today.getTime() > now.getTime()) return today.getTime() - now.getTime()
  }
  const cursor = new Date(now)
  for (let i = 0; i < 14; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isTradingDay(cursor, meta))
      return tzHhmmToUtc(localDateString(cursor, USER_TZ), USER_TZ, open).getTime() - now.getTime()
  }
  return 0
}

export function msUntilClose(exchange: ExchangeCode, now: Date, window?: MarketWindow): number {
  if (!isMarketOpen(exchange, now, window)) return 0
  const close = window?.activeTo ?? EXCHANGES[exchange].defaultClose
  return Math.max(
    0,
    tzHhmmToUtc(localDateString(now, USER_TZ), USER_TZ, close).getTime() - now.getTime()
  )
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
