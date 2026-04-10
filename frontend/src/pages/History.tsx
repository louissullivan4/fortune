import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { api, type Decision, type Order, type Paginated } from '../api/client'
import SignalBadge from '../components/SignalBadge'
import type { SignalType } from '../api/client'

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
        justifyContent: 'flex-end',
      }}
    >
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={14} />
      </button>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {page} / {totalPages}
      </span>
      <button
        className="btn btn-ghost"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

function DecisionModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.decisions
      .get(id)
      .then(setDecision)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-page)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 8,
          width: 640,
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 24,
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>Decision #{id}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '0 6px' }}>
            <X size={14} />
          </button>
        </div>

        {loading && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>
        )}
        {decision && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  action
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    background:
                      decision.action === 'buy'
                        ? 'rgba(22,163,74,0.1)'
                        : decision.action === 'sell'
                          ? 'rgba(220,38,38,0.1)'
                          : 'var(--color-bg-raised)',
                    color:
                      decision.action === 'buy'
                        ? '#16a34a'
                        : decision.action === 'sell'
                          ? '#dc2626'
                          : 'var(--color-text-muted)',
                  }}
                >
                  {decision.action.toUpperCase()}
                </span>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  ticker
                </div>
                <span style={{ fontFamily: 'var(--font-code)' }}>{decision.ticker ?? '—'}</span>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  quantity
                </div>
                <span style={{ fontFamily: 'var(--font-code)' }}>{decision.quantity ?? '—'}</span>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  price
                </div>
                <span style={{ fontFamily: 'var(--font-code)' }}>
                  {decision.estimatedPrice != null ? `€${decision.estimatedPrice.toFixed(2)}` : '—'}
                </span>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  status
                </div>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {decision.orderStatus ?? '—'}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>
                claude reasoning
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {decision.reasoning}
              </div>
            </div>

            {Array.isArray(decision.signals) && decision.signals.length > 0 && (
              <div>
                <div className="section-label" style={{ marginBottom: 8 }}>
                  signals at decision time
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    decision.signals as Array<{
                      ticker: string
                      signal: SignalType
                      reasons: string[]
                    }>
                  ).map((s) => (
                    <div key={s.ticker} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-code)' }}>
                        {s.ticker}
                      </span>
                      <SignalBadge signal={s.signal} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function History() {
  const [tab, setTab] = useState<'decisions' | 'orders'>('decisions')
  const [decisions, setDecisions] = useState<Paginated<Decision> | null>(null)
  const [orders, setOrders] = useState<Paginated<Order> | null>(null)
  const [dPage, setDPage] = useState(1)
  const [oPage, setOPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const loadDecisions = useCallback(async (page: number) => {
    setLoading(true)
    try {
      setDecisions(await api.decisions.list(page, 20))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOrders = useCallback(async (page: number) => {
    setLoading(true)
    try {
      setOrders(await api.orders.list(page, 20))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDecisions(dPage)
  }, [dPage, loadDecisions])
  useEffect(() => {
    if (tab === 'orders') loadOrders(oPage)
  }, [tab, oPage, loadOrders])

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 24px' }}>History</h1>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 16,
          borderBottom: '0.5px solid var(--color-border)',
        }}
      >
        {(['decisions', 'orders'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
              color: tab === t ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom:
                tab === t ? '1.5px solid var(--color-accent)' : '1.5px solid transparent',
              marginBottom: -0.5,
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'decisions' && decisions && (
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {decisions.total}
              </span>
            )}
            {t === 'orders' && orders && (
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {orders.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Loading...
        </div>
      )}

      {/* Decisions table */}
      {tab === 'decisions' && decisions && (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Ticker</th>
                  <th>Qty</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th>Status</th>
                  <th>Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {decisions.data.map((d) => (
                  <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(d.id)}>
                    <td
                      style={{
                        fontFamily: 'var(--font-code)',
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(d.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '1px 6px',
                          borderRadius: 9999,
                          background:
                            d.action === 'buy'
                              ? 'rgba(22,163,74,0.1)'
                              : d.action === 'sell'
                                ? 'rgba(220,38,38,0.1)'
                                : 'var(--color-bg-raised)',
                          color:
                            d.action === 'buy'
                              ? '#16a34a'
                              : d.action === 'sell'
                                ? '#dc2626'
                                : 'var(--color-text-muted)',
                        }}
                      >
                        {d.action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-code)' }}>{d.ticker ?? '—'}</td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{d.quantity ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                      {d.estimatedPrice != null ? `€${d.estimatedPrice.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {d.orderStatus ?? '—'}
                    </td>
                    <td
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary)',
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.reasoning}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={dPage} totalPages={decisions.totalPages} onPage={setDPage} />
        </>
      )}

      {/* Orders table */}
      {tab === 'orders' && orders && (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Ticker</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Fill price</th>
                  <th style={{ textAlign: 'right' }}>Fill qty</th>
                  <th>T212 order ID</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((o) => (
                  <tr key={o.id}>
                    <td
                      style={{
                        fontFamily: 'var(--font-code)',
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(o.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '1px 6px',
                          borderRadius: 9999,
                          background:
                            o.action === 'buy' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                          color: o.action === 'buy' ? '#16a34a' : '#dc2626',
                        }}
                      >
                        {o.action?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-code)' }}>{o.ticker ?? '—'}</td>
                    <td
                      style={{
                        fontSize: 12,
                        color:
                          o.status?.startsWith('error') || o.status?.startsWith('blocked')
                            ? '#dc2626'
                            : 'var(--color-text-secondary)',
                      }}
                    >
                      {o.status}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                      {o.fillPrice != null ? `€${o.fillPrice.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                      {o.fillQuantity ?? '—'}
                    </td>
                    <td
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-code)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {o.t212OrderId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={oPage} totalPages={orders.totalPages} onPage={setOPage} />
        </>
      )}

      {selectedId !== null && <DecisionModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
