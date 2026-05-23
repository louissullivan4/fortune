import { useEffect, useState } from 'react'
import { type MarketSpec, NYSE, isMarketOpen, msUntilOpen, msUntilClose } from '../markets/registry'

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

interface Props {
  /** Market to display. Defaults to NYSE for backwards compatibility. */
  spec?: MarketSpec
  /** Compact one-line layout used in the sidebar (vs. the larger Dashboard banner). */
  compact?: boolean
}

export default function MarketClock({ spec = NYSE, compact = false }: Props) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const open = isMarketOpen(spec, now)
  const ms = open ? msUntilClose(spec, now) : msUntilOpen(spec, now)

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: open ? '#16a34a' : 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: open ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
          }}
        >
          {spec.displayName} {open ? `· ${fmtDuration(ms)}` : 'closed'}
        </span>
      </div>
    )
  }

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
            {spec.displayName}
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
