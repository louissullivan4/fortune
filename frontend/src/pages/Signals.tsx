import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { api, type TickerSignal } from '../api/client'
import SignalBadge from '../components/SignalBadge'

function fmt(v: number | null | undefined, d = 2): string {
  return v == null ? '—' : v.toFixed(d)
}

function IndicatorTable({ ind }: { ind: TickerSignal['indicators'] }) {
  const rows = [
    { label: 'Price',        value: `€${fmt(ind.currentPrice)}` },
    { label: '1d change',    value: ind.priceChange1d != null ? `${ind.priceChange1d > 0 ? '+' : ''}${fmt(ind.priceChange1d)}%` : '—', positive: (ind.priceChange1d ?? 0) > 0, negative: (ind.priceChange1d ?? 0) < 0 },
    { label: 'RSI 14',       value: fmt(ind.rsi14), warn: ind.rsi14 != null && (ind.rsi14 > 70 || ind.rsi14 < 30) },
    { label: 'SMA 20',       value: `€${fmt(ind.sma20)}` },
    { label: 'SMA 50',       value: `€${fmt(ind.sma50)}` },
    { label: 'EMA 9',        value: `€${fmt(ind.ema9)}` },
    { label: 'EMA 21',       value: `€${fmt(ind.ema21)}` },
    { label: 'MACD',         value: fmt(ind.macd, 4) },
    { label: 'MACD signal',  value: fmt(ind.macdSignal, 4) },
    { label: 'MACD hist.',   value: fmt(ind.macdHistogram, 4), positive: (ind.macdHistogram ?? 0) > 0, negative: (ind.macdHistogram ?? 0) < 0 },
    { label: 'BB upper',     value: `€${fmt(ind.bollingerUpper)}` },
    { label: 'BB middle',    value: `€${fmt(ind.bollingerMiddle)}` },
    { label: 'BB lower',     value: `€${fmt(ind.bollingerLower)}` },
    { label: 'BB %B',        value: fmt(ind.bollingerPctB), warn: ind.bollingerPctB != null && (ind.bollingerPctB > 0.8 || ind.bollingerPctB < 0.2) },
    { label: 'Stoch %K',     value: fmt(ind.stochK) },
    { label: 'Stoch %D',     value: fmt(ind.stochD) },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', padding: '12px 0 4px' }}>
      {rows.map(({ label, value, positive, negative, warn }) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid var(--color-border)' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
          <span style={{
            fontSize: 12, fontFamily: 'var(--font-code)',
            color: positive ? '#16a34a' : negative ? '#dc2626' : warn ? '#ca8a04' : 'var(--color-text-primary)',
          }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

function SignalRow({ signal, expanded, onToggle }: {
  signal: TickerSignal
  expanded: boolean
  onToggle: () => void
}) {
  const ind = signal.indicators
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />}
            <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{signal.ticker}</span>
            {signal.heldPosition && <span className="badge" style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--color-accent)', fontSize: 10 }}>held</span>}
          </div>
        </td>
        <td><SignalBadge signal={signal.signal} /></td>
        <td style={{ fontFamily: 'var(--font-code)' }}>€{fmt(ind.currentPrice)}</td>
        <td style={{ color: (ind.priceChange1d ?? 0) >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'var(--font-code)' }}>
          {ind.priceChange1d != null ? `${ind.priceChange1d > 0 ? '+' : ''}${fmt(ind.priceChange1d)}%` : '—'}
        </td>
        <td style={{ fontFamily: 'var(--font-code)', color: ind.rsi14 != null && (ind.rsi14 > 70 || ind.rsi14 < 30) ? '#ca8a04' : 'var(--color-text-primary)' }}>
          {fmt(ind.rsi14)}
        </td>
        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {signal.reasons[0] ?? '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: '0 16px 12px 36px', background: 'var(--color-bg-surface)' }}>
            <IndicatorTable ind={ind} />
            <div style={{ marginTop: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>reasons ({signal.reasons.length})</div>
              {signal.reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '2px 0' }}>· {r}</div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Signals() {
  const [signals, setSignals] = useState<TickerSignal[]>([])
  const [computedAt, setComputedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = refresh ? await api.signals.refresh() : await api.signals.get()
      setSignals(res.data)
      setComputedAt(res.computedAt)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (ticker: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  const signalOrder: Record<string, number> = { strong_buy: 0, buy: 1, hold: 2, sell: 3, strong_sell: 4 }
  const sorted = [...signals].sort((a, b) => (signalOrder[a.signal] ?? 5) - (signalOrder[b.signal] ?? 5))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Signals</h1>
          {computedAt && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              computed {new Date(computedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => load(true)} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'computing...' : 'refresh'}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{error}</div>}

      {signals.length === 0 && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No signals. Click refresh to compute.
        </div>
      )}

      {signals.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Signal</th>
                <th>Price</th>
                <th>1d change</th>
                <th>RSI</th>
                <th>Top reason</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <SignalRow
                  key={s.ticker}
                  signal={s}
                  expanded={expanded.has(s.ticker)}
                  onToggle={() => toggle(s.ticker)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
