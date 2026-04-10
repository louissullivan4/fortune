import { useEffect, useState } from 'react'

const MARKETS = [
  { name: 'LSE', openH: 8, openM: 0, closeH: 16, closeM: 30 },
  { name: 'NYSE', openH: 14, openM: 30, closeH: 21, closeM: 0 },
] as const

function isWeekday(d: Date) {
  const day = d.getUTCDay()
  return day >= 1 && day <= 5
}

function msUntilClose(m: (typeof MARKETS)[number], now: Date): number {
  const t = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), m.closeH, m.closeM, 0)
  )
  return t.getTime() - now.getTime()
}

function msUntilNextOpen(m: (typeof MARKETS)[number], now: Date): number {
  // Today's open (if still in future and it's a weekday)
  const todayOpen = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), m.openH, m.openM, 0)
  )
  if (isWeekday(now) && todayOpen.getTime() > now.getTime()) {
    return todayOpen.getTime() - now.getTime()
  }
  // Find next weekday
  const next = new Date(now)
  next.setUTCDate(next.getUTCDate() + 1)
  while (!isWeekday(next)) next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(m.openH, m.openM, 0, 0)
  return next.getTime() - now.getTime()
}

function isOpen(m: (typeof MARKETS)[number], now: Date): boolean {
  if (!isWeekday(now)) return false
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const open = m.openH * 60 + m.openM
  const close = m.closeH * 60 + m.closeM
  return mins >= open && mins < close
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
      {/* Clock */}
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

      {/* Markets */}
      {MARKETS.map((m) => {
        const open = isOpen(m, now)
        const ms = open ? msUntilClose(m, now) : msUntilNextOpen(m, now)
        return (
          <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                {m.name}
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
        )
      })}
    </div>
  )
}
