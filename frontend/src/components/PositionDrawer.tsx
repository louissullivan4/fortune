import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, type PnlPosition, type PositionDetails, type SignalType } from '../api/client'
import SignalBadge from './SignalBadge'

interface Props {
  position: PnlPosition | null
  onClose: () => void
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate()
  const month = d.toLocaleDateString('en-GB', { month: 'short' })
  const hrs = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${hrs}:${mins}`
}

function shortTicker(ticker: string): string {
  return ticker.replace(/_US_EQ$/, '').replace(/_EQ$/, '')
}

function OrderStatusBadge({ status }: { status: string }) {
  const isError = status.startsWith('error') || status.startsWith('blocked')
  return (
    <span
      style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 9999,
        background: isError ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
        color: isError ? '#dc2626' : '#16a34a',
        fontFamily: 'var(--font-code)',
      }}
    >
      {status}
    </span>
  )
}

function DecisionSection({
  label,
  decision,
  highlightTicker,
}: {
  label: string
  decision: { timestamp: string; reasoning: string; signals: Array<{ ticker: string; signal: SignalType; reasons: string[] }>; orderStatus: string | null }
  highlightTicker: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div className="section-label">{label}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-code)' }}>
          {fmtDateTime(decision.timestamp)}
        </div>
        {decision.orderStatus && <OrderStatusBadge status={decision.orderStatus} />}
      </div>

      <div
        style={{
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.55,
          padding: '10px 12px',
          background: 'var(--color-bg-surface)',
          borderRadius: 6,
          border: '0.5px solid var(--color-border)',
          marginBottom: decision.signals.length > 0 ? 10 : 0,
        }}
      >
        {decision.reasoning}
      </div>

      {decision.signals.length > 0 && (
        <table className="table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Signal</th>
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {decision.signals.map((s) => (
              <tr
                key={s.ticker}
                style={{
                  background:
                    s.ticker === highlightTicker ? 'var(--color-bg-surface)' : undefined,
                }}
              >
                <td
                  style={{
                    fontFamily: 'var(--font-code)',
                    fontWeight: s.ticker === highlightTicker ? 500 : 400,
                  }}
                >
                  {shortTicker(s.ticker)}
                </td>
                <td>
                  <SignalBadge signal={s.signal} />
                </td>
                <td style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                  {s.reasons.join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function PositionDrawer({ position, onClose }: Props) {
  const [details, setDetails] = useState<PositionDetails | null>(null)
  const [loadedForId, setLoadedForId] = useState<number | null>(null)

  const loading = position !== null && loadedForId !== position.id

  useEffect(() => {
    if (!position) return
    let cancelled = false
    api.analytics
      .positionDetails(position.id)
      .then((d) => {
        if (!cancelled) {
          setDetails(d)
          setLoadedForId(position.id)
        }
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [position?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const netPnlColor = (position?.netPnl ?? 0) >= 0 ? '#16a34a' : '#dc2626'
  const isOpen = position !== null

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.22)',
          zIndex: 100,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 150ms ease',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: 'var(--color-bg-page)',
          borderLeft: '0.5px solid var(--color-border)',
          zIndex: 101,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 150ms ease',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {position && (
          <>
            <div
              style={{
                padding: '16px 16px 12px',
                borderBottom: '0.5px solid var(--color-border)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                position: 'sticky',
                top: 0,
                background: 'var(--color-bg-page)',
                zIndex: 1,
              }}
            >
              <div>
                <div style={{ fontFamily: 'var(--font-code)', fontWeight: 500, fontSize: 15 }}>
                  {shortTicker(position.ticker)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {fmtDateTime(position.openedAt)} →{' '}
                  {position.closedAt ? fmtDateTime(position.closedAt) : '—'}
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                padding: '12px 16px',
                borderBottom: '0.5px solid var(--color-border)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {(
                  [
                    ['qty', String(position.quantity)],
                    [
                      'entry',
                      position.entryPrice != null ? `€${position.entryPrice.toFixed(2)}` : '—',
                    ],
                    [
                      'exit',
                      position.exitPrice != null ? `€${position.exitPrice.toFixed(2)}` : '—',
                    ],
                    [
                      'gross P&L',
                      position.grossPnl != null
                        ? `${position.grossPnl >= 0 ? '+' : ''}€${position.grossPnl.toFixed(2)}`
                        : '—',
                    ],
                    ['FX fee', position.fxCost > 0 ? `-€${position.fxCost.toFixed(2)}` : '—'],
                    [
                      'net P&L',
                      position.netPnl != null
                        ? `${position.netPnl >= 0 ? '+' : ''}€${position.netPnl.toFixed(2)}`
                        : '—',
                    ],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <div
                      className="section-label"
                      style={{ fontSize: 10, marginBottom: 2 }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontFamily: 'var(--font-code)',
                        fontWeight: label === 'net P&L' ? 500 : 400,
                        color:
                          label === 'net P&L' ? netPnlColor : 'var(--color-text-primary)',
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {loading && (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading...</div>
              )}
              {!loading && details && (
                <>
                  {details.sellDecision && (
                    <DecisionSection
                      label="exit decision"
                      decision={details.sellDecision}
                      highlightTicker={position.ticker}
                    />
                  )}
                  {details.buyDecision && (
                    <DecisionSection
                      label="buy decision"
                      decision={details.buyDecision}
                      highlightTicker={position.ticker}
                    />
                  )}
                  {!details.buyDecision && !details.sellDecision && (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                      No decision records found for this position.
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
