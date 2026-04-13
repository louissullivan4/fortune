import { useEffect, useState } from 'react'

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

const NYSE_OPEN_EASTERN_MINS = 9 * 60 + 30
const NYSE_CLOSE_EASTERN_MINS = 16 * 60

function nyDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(date)
}

function nyMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function nyIsWeekday(date: Date): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(date)
  return day !== 'Sun' && day !== 'Sat'
}

function nyIsHoliday(date: Date): boolean {
  return NYSE_HOLIDAYS.has(nyDateString(date))
}

function nyseOpenUtcTime(date: Date): Date {
  const dateStr = nyDateString(date)
  const ref = new Date(`${dateStr}T17:00:00Z`)
  const refEasternHour =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(ref)
        .find((p) => p.type === 'hour')?.value ?? '13'
    ) % 24
  const offsetHours = 17 - refEasternHour
  const pad = (n: number) => String(n).padStart(2, '0')
  return new Date(`${dateStr}T09:30:00-${pad(offsetHours)}:00`)
}

function nyseCloseUtcTime(date: Date): Date {
  const dateStr = nyDateString(date)
  const ref = new Date(`${dateStr}T17:00:00Z`)
  const refEasternHour =
    parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(ref)
        .find((p) => p.type === 'hour')?.value ?? '13'
    ) % 24
  const offsetHours = 17 - refEasternHour
  const pad = (n: number) => String(n).padStart(2, '0')
  return new Date(`${dateStr}T16:00:00-${pad(offsetHours)}:00`)
}

function isNyseOpen(now: Date): boolean {
  if (!nyIsWeekday(now) || nyIsHoliday(now)) return false
  const mins = nyMinutesOfDay(now)
  return mins >= NYSE_OPEN_EASTERN_MINS && mins < NYSE_CLOSE_EASTERN_MINS
}

function msUntilNextOpen(now: Date): number {
  if (nyIsWeekday(now) && !nyIsHoliday(now)) {
    const openTime = nyseOpenUtcTime(now)
    if (openTime.getTime() > now.getTime()) return openTime.getTime() - now.getTime()
  }
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0)
  )
  while (!nyIsWeekday(next) || nyIsHoliday(next)) next.setUTCDate(next.getUTCDate() + 1)
  return nyseOpenUtcTime(next).getTime() - now.getTime()
}

function msUntilClose(now: Date): number {
  return nyseCloseUtcTime(now).getTime() - now.getTime()
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtUtc(d: Date): string {
  return d.toISOString().slice(11, 19) + ' UTC'
}

function fmtLocal(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function MarketClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const open = isNyseOpen(now)
  const ms = open ? msUntilClose(now) : msUntilNextOpen(now)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
        padding: '8px 12px',
        background: 'var(--color-bg-raised)',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontFamily: 'var(--font-code)',
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: '0.02em',
          }}
        >
          {fmtLocal(now)}
        </span>
        <span
          style={{ fontFamily: 'var(--font-code)', color: 'var(--color-text-muted)', fontSize: 11 }}
        >
          {fmtUtc(now)}
        </span>
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--color-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: open ? '#16a34a' : 'var(--color-text-muted)',
              boxShadow: open ? '0 0 4px #16a34a88' : 'none',
            }}
          />
          <span
            style={{
              fontWeight: 500,
              color: open ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}
          >
            NYSE
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 4,
              background: open ? 'rgba(22,163,74,0.12)' : 'var(--color-bg-surface)',
              color: open ? '#16a34a' : 'var(--color-text-muted)',
            }}
          >
            {open ? 'OPEN' : 'CLOSED'}
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', paddingLeft: 12 }}>
          {open ? `closes in ${fmtDuration(ms)}` : `opens in ${fmtDuration(ms)}`}
        </span>
      </div>
    </div>
  )
}
