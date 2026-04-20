import { useEffect, useState } from 'react'
import {
  EXCHANGES,
  fmtDuration,
  isMarketOpen,
  msUntilClose,
  nextOpenMs,
  type MarketWindow,
} from '../lib/markets'

function fmtUtc(d: Date): string {
  return d.toISOString().slice(11, 19) + ' UTC'
}

function fmtLocal(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface Props {
  /** Markets to display. If omitted, just shows NYSE for backwards compat. */
  markets?: MarketWindow[]
}

export default function MarketClock({ markets }: Props = {}) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const toShow: MarketWindow[] =
    markets && markets.length > 0
      ? markets.filter((m) => m.enabled)
      : [{ exchange: 'NYSE', activeFrom: '09:30', activeTo: '16:00', enabled: true }]

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

      {toShow.map((m) => {
        const meta = EXCHANGES[m.exchange]
        const open = isMarketOpen(m.exchange, now, m)
        const ms = open ? msUntilClose(m.exchange, now, m) : nextOpenMs(m.exchange, now, m)
        return (
          <div key={m.exchange} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
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
                  {meta.shortName}
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
      })}
    </div>
  )
}
