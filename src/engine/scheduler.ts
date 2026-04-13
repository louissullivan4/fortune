// ── Market hours utilities ─────────────────────────────────────────────────

interface MarketWindow {
  name: string
  openUtcHour: number
  openUtcMin: number
  closeUtcHour: number
  closeUtcMin: number
  holidays: Set<string>
}

const NYSE_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])

const MARKETS: MarketWindow[] = [
  { name: 'NYSE', openUtcHour: 14, openUtcMin: 30, closeUtcHour: 21, closeUtcMin: 0, holidays: NYSE_HOLIDAYS },
]

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

function toMinutes(hour: number, min: number): number {
  return hour * 60 + min
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isMarketOpen(): boolean {
  const now = new Date()
  if (!isWeekday(now)) return false
  const today = utcDateString(now)
  const currentMins = toMinutes(now.getUTCHours(), now.getUTCMinutes())
  return MARKETS.some((m) => {
    if (m.holidays.has(today)) return false
    const open = toMinutes(m.openUtcHour, m.openUtcMin)
    const close = toMinutes(m.closeUtcHour, m.closeUtcMin)
    return currentMins >= open && currentMins < close
  })
}

export function nextOpenMs(): number {
  const now = new Date()
  const today = utcDateString(now)

  for (const m of MARKETS) {
    if (!m.holidays.has(today)) {
      const openTime = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), m.openUtcHour, m.openUtcMin, 0, 0)
      )
      if (openTime.getTime() > now.getTime()) {
        return openTime.getTime() - now.getTime()
      }
    }
  }

  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  while (!isWeekday(next) || MARKETS[0].holidays.has(utcDateString(next))) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  next.setUTCHours(MARKETS[0].openUtcHour, MARKETS[0].openUtcMin, 0, 0)
  return next.getTime() - now.getTime()
}
