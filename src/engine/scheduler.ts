const NYSE_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
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
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0') % 24
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
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
        .find(p => p.type === 'hour')?.value ?? '13',
    ) % 24
  const offsetHours = 17 - refEasternHour
  const pad = (n: number) => String(n).padStart(2, '0')
  return new Date(`${dateStr}T09:30:00-${pad(offsetHours)}:00`)
}

export function isMarketOpen(): boolean {
  const now = new Date()
  if (!nyIsWeekday(now) || nyIsHoliday(now)) return false
  const mins = nyMinutesOfDay(now)
  return mins >= NYSE_OPEN_EASTERN_MINS && mins < NYSE_CLOSE_EASTERN_MINS
}

export function nextOpenMs(): number {
  const now = new Date()

  if (nyIsWeekday(now) && !nyIsHoliday(now)) {
    const openTime = nyseOpenUtcTime(now)
    if (openTime.getTime() > now.getTime()) {
      return openTime.getTime() - now.getTime()
    }
  }

  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 0, 0),
  )
  while (!nyIsWeekday(next) || nyIsHoliday(next)) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return nyseOpenUtcTime(next).getTime() - now.getTime()
}
