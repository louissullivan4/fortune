// ── Market hours utilities ─────────────────────────────────────────────────

interface MarketWindow {
  name: string
  openUtcHour: number
  openUtcMin: number
  closeUtcHour: number
  closeUtcMin: number
}

const MARKETS: MarketWindow[] = [
  { name: 'LSE', openUtcHour: 8, openUtcMin: 0, closeUtcHour: 16, closeUtcMin: 30 },
  { name: 'US', openUtcHour: 14, openUtcMin: 30, closeUtcHour: 21, closeUtcMin: 0 },
]

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

function toMinutes(hour: number, min: number): number {
  return hour * 60 + min
}

export function isMarketOpen(): boolean {
  const now = new Date()
  if (!isWeekday(now)) return false
  const currentMins = toMinutes(now.getUTCHours(), now.getUTCMinutes())
  return MARKETS.some((m) => {
    const open = toMinutes(m.openUtcHour, m.openUtcMin)
    const close = toMinutes(m.closeUtcHour, m.closeUtcMin)
    return currentMins >= open && currentMins < close
  })
}

export function nextOpenMs(): number {
  const now = new Date()
  const todayMins = toMinutes(now.getUTCHours(), now.getUTCMinutes())

  for (const m of MARKETS) {
    const open = toMinutes(m.openUtcHour, m.openUtcMin)
    if (open > todayMins) {
      return (open - todayMins) * 60 * 1000
    }
  }

  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  while (!isWeekday(tomorrow)) {
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  }
  tomorrow.setUTCHours(MARKETS[0].openUtcHour, MARKETS[0].openUtcMin, 0, 0)
  return tomorrow.getTime() - now.getTime()
}
