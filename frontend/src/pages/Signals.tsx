import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, Search, Copy, Check } from 'lucide-react'
import { api, type TickerSignal, type Decision, type Order, type Paginated } from '../api/client'
import SignalBadge from '../components/SignalBadge'
import type { SignalType } from '../api/client'

type DecisionFilter = 'all' | 'actions' | 'holds'
type SignalFilter = 'all' | SignalType

function fmt(v: number | null | undefined, d = 2): string {
  return v == null ? '—' : v.toFixed(d)
}

function IndicatorTable({ ind }: { ind: TickerSignal['indicators'] }) {
  const rows = [
    { label: 'Price', value: `€${fmt(ind.currentPrice)}` },
    {
      label: '1d change',
      value:
        ind.priceChange1d != null
          ? `${ind.priceChange1d > 0 ? '+' : ''}${fmt(ind.priceChange1d)}%`
          : '—',
      positive: (ind.priceChange1d ?? 0) > 0,
      negative: (ind.priceChange1d ?? 0) < 0,
    },
    {
      label: 'RSI 14',
      value: fmt(ind.rsi14),
      warn: ind.rsi14 != null && (ind.rsi14 > 70 || ind.rsi14 < 30),
    },
    { label: 'SMA 20', value: `€${fmt(ind.sma20)}` },
    { label: 'SMA 50', value: `€${fmt(ind.sma50)}` },
    { label: 'EMA 9', value: `€${fmt(ind.ema9)}` },
    { label: 'EMA 21', value: `€${fmt(ind.ema21)}` },
    { label: 'MACD', value: fmt(ind.macd, 4) },
    { label: 'MACD signal', value: fmt(ind.macdSignal, 4) },
    {
      label: 'MACD hist.',
      value: fmt(ind.macdHistogram, 4),
      positive: (ind.macdHistogram ?? 0) > 0,
      negative: (ind.macdHistogram ?? 0) < 0,
    },
    { label: 'BB upper', value: `€${fmt(ind.bollingerUpper)}` },
    { label: 'BB middle', value: `€${fmt(ind.bollingerMiddle)}` },
    { label: 'BB lower', value: `€${fmt(ind.bollingerLower)}` },
    {
      label: 'BB %B',
      value: fmt(ind.bollingerPctB),
      warn: ind.bollingerPctB != null && (ind.bollingerPctB > 0.8 || ind.bollingerPctB < 0.2),
    },
    { label: 'Stoch %K', value: fmt(ind.stochK) },
    { label: 'Stoch %D', value: fmt(ind.stochD) },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0 24px',
        padding: '12px 0 4px',
      }}
    >
      {rows.map(({ label, value, positive, negative, warn }) => (
        <div
          key={label}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '4px 0',
            borderBottom: '0.5px solid var(--color-border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
          <span
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-code)',
              color: positive
                ? '#16a34a'
                : negative
                  ? '#dc2626'
                  : warn
                    ? '#ca8a04'
                    : 'var(--color-text-primary)',
            }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  )
}

function SignalRow({
  signal,
  expanded,
  onToggle,
}: {
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
            {expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
            )}
            <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{signal.ticker}</span>
            {signal.heldPosition && (
              <span
                className="badge"
                style={{
                  background: 'rgba(37,99,235,0.1)',
                  color: 'var(--color-accent)',
                  fontSize: 10,
                }}
              >
                held
              </span>
            )}
          </div>
        </td>
        <td>
          <SignalBadge signal={signal.signal} />
        </td>
        <td style={{ fontFamily: 'var(--font-code)' }}>€{fmt(ind.currentPrice)}</td>
        <td
          style={{
            color: (ind.priceChange1d ?? 0) >= 0 ? '#16a34a' : '#dc2626',
            fontFamily: 'var(--font-code)',
          }}
        >
          {ind.priceChange1d != null
            ? `${ind.priceChange1d > 0 ? '+' : ''}${fmt(ind.priceChange1d)}%`
            : '—'}
        </td>
        <td
          style={{
            fontFamily: 'var(--font-code)',
            color:
              ind.rsi14 != null && (ind.rsi14 > 70 || ind.rsi14 < 30)
                ? '#ca8a04'
                : 'var(--color-text-primary)',
          }}
        >
          {fmt(ind.rsi14)}
        </td>
        <td
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            maxWidth: 300,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {signal.reasons[0] ?? '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={6}
            style={{ padding: '0 16px 12px 36px', background: 'var(--color-bg-surface)' }}
          >
            <IndicatorTable ind={ind} />
            <div style={{ marginTop: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>
                reasons ({signal.reasons.length})
              </div>
              {signal.reasons.map((r, i) => (
                <div
                  key={i}
                  style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '2px 0' }}
                >
                  · {r}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ActionBadge({ action }: { action: string }) {
  const isAction = action === 'buy' || action === 'sell'
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: '1px 6px',
        borderRadius: 9999,
        background:
          action === 'buy'
            ? 'rgba(22,163,74,0.1)'
            : action === 'sell'
              ? 'rgba(220,38,38,0.1)'
              : 'var(--color-bg-raised)',
        color:
          action === 'buy' ? '#16a34a' : action === 'sell' ? '#dc2626' : 'var(--color-text-muted)',
      }}
    >
      {isAction ? action.toUpperCase() : 'HOLD'}
    </span>
  )
}

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
        ←
      </button>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {page} / {totalPages}
      </span>
      <button
        className="btn btn-ghost"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        →
      </button>
    </div>
  )
}

const SIGNAL_TYPES: { value: SignalFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong_buy', label: 'Strong buy' },
  { value: 'buy', label: 'Buy' },
  { value: 'hold', label: 'Hold' },
  { value: 'sell', label: 'Sell' },
  { value: 'strong_sell', label: 'Strong sell' },
]

const SIGNAL_ORDER: Record<string, number> = {
  strong_buy: 0,
  buy: 1,
  hold: 2,
  sell: 3,
  strong_sell: 4,
}

export default function SignalsAndTrades() {
  const [activeTab, setActiveTab] = useState<'signals' | 'decisions' | 'orders'>('signals')

  const [signals, setSignals] = useState<TickerSignal[]>([])
  const [computedAt, setComputedAt] = useState<string | null>(null)
  const [signalsLoading, setSignalsLoading] = useState(false)
  const [signalsError, setSignalsError] = useState<string | null>(null)
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set())
  const [signalTypeFilter, setSignalTypeFilter] = useState<SignalFilter>('all')
  const [tickerSearch, setTickerSearch] = useState('')

  const [decisions, setDecisions] = useState<Paginated<Decision> | null>(null)
  const [dPage, setDPage] = useState(1)
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('actions')
  const [expandedDecisionIds, setExpandedDecisionIds] = useState<Set<number>>(new Set())
  const [expandedDecisionData, setExpandedDecisionData] = useState<Record<number, Decision>>({})

  const [orders, setOrders] = useState<Paginated<Order> | null>(null)
  const [oPage, setOPage] = useState(1)
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null)
  const [tabLoading, setTabLoading] = useState(false)

  const loadSignals = useCallback(async (refresh = false) => {
    setSignalsLoading(true)
    setSignalsError(null)
    try {
      const res = refresh ? await api.signals.refresh() : await api.signals.get()
      setSignals(res.data)
      setComputedAt(res.computedAt)
    } catch (e) {
      setSignalsError((e as Error).message)
    } finally {
      setSignalsLoading(false)
    }
  }, [])

  const loadDecisions = useCallback(async (page: number) => {
    setTabLoading(true)
    try {
      setDecisions(await api.decisions.list(page, 50))
    } finally {
      setTabLoading(false)
    }
  }, [])

  const loadOrders = useCallback(async (page: number) => {
    setTabLoading(true)
    try {
      setOrders(await api.orders.list(page, 20))
    } finally {
      setTabLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSignals()
  }, [loadSignals])

  useEffect(() => {
    if (activeTab === 'decisions') loadDecisions(dPage)
  }, [activeTab, dPage, loadDecisions])

  useEffect(() => {
    if (activeTab === 'orders') loadOrders(oPage)
  }, [activeTab, oPage, loadOrders])

  function toggleSignal(ticker: string) {
    setExpandedSignals((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  function toggleDecision(id: number) {
    setExpandedDecisionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        if (!expandedDecisionData[id]) {
          api.decisions
            .get(id)
            .then((d) => setExpandedDecisionData((prev) => ({ ...prev, [id]: d })))
            .catch(console.error)
        }
      }
      return next
    })
  }

  function copyOrderId(id: string) {
    navigator.clipboard.writeText(id).catch(() => {})
    setCopiedOrderId(id)
    setTimeout(() => setCopiedOrderId(null), 1500)
  }

  const filteredSignals = signals
    .filter((s) => signalTypeFilter === 'all' || s.signal === signalTypeFilter)
    .filter(
      (s) => tickerSearch === '' || s.ticker.toLowerCase().includes(tickerSearch.toLowerCase())
    )
    .sort((a, b) => (SIGNAL_ORDER[a.signal] ?? 5) - (SIGNAL_ORDER[b.signal] ?? 5))

  const filteredDecisions = (decisions?.data ?? []).filter((d) => {
    if (decisionFilter === 'actions') return d.action === 'buy' || d.action === 'sell'
    if (decisionFilter === 'holds') return d.action === 'hold'
    return true
  })

  const tabs = [
    { key: 'signals' as const, label: 'Signals', count: signals.length },
    { key: 'decisions' as const, label: 'Decisions', count: decisions?.total },
    { key: 'orders' as const, label: 'Orders', count: orders?.total },
  ]

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 20px' }}>Signals & Trades</h1>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '0.5px solid var(--color-border)',
          marginBottom: 16,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
              color: activeTab === t.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom:
                activeTab === t.key ? '1.5px solid var(--color-accent)' : '1.5px solid transparent',
              marginBottom: -0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Signals tab ── */}
      {activeTab === 'signals' && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Signal type filter chips */}
              {SIGNAL_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => setSignalTypeFilter(st.value)}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 9999,
                    border: '0.5px solid var(--color-border)',
                    background:
                      signalTypeFilter === st.value ? 'var(--color-bg-raised)' : 'transparent',
                    color:
                      signalTypeFilter === st.value
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-muted)',
                    fontSize: 12,
                    fontWeight: signalTypeFilter === st.value ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                >
                  {st.label}
                </button>
              ))}
              {/* Ticker search */}
              <div style={{ position: 'relative' }}>
                <Search
                  size={12}
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-text-muted)',
                  }}
                />
                <input
                  className="input"
                  placeholder="Search ticker..."
                  value={tickerSearch}
                  onChange={(e) => setTickerSearch(e.target.value)}
                  style={{ paddingLeft: 26, width: 140, height: 28, fontSize: 12 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {computedAt && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  computed {new Date(computedAt).toLocaleTimeString()}
                </span>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => loadSignals(true)}
                disabled={signalsLoading}
              >
                <RefreshCw size={13} />
                {signalsLoading ? 'computing...' : 'refresh'}
              </button>
            </div>
          </div>

          {signalsError && (
            <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{signalsError}</div>
          )}

          {filteredSignals.length === 0 && !signalsLoading && (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '48px 0',
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}
            >
              {signals.length === 0
                ? 'No signals. Click refresh to compute.'
                : 'No signals match the current filter.'}
            </div>
          )}

          {filteredSignals.length > 0 && (
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
                  {filteredSignals.map((s) => (
                    <SignalRow
                      key={s.ticker}
                      signal={s}
                      expanded={expandedSignals.has(s.ticker)}
                      onToggle={() => toggleSignal(s.ticker)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Decisions tab ── */}
      {activeTab === 'decisions' && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            {/* Filter toggle */}
            <div
              style={{
                display: 'flex',
                border: '0.5px solid var(--color-border)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              {(
                [
                  { value: 'actions', label: 'Actions only' },
                  { value: 'all', label: 'Show all' },
                  { value: 'holds', label: 'Holds only' },
                ] as { value: DecisionFilter; label: string }[]
              ).map((f, i, arr) => (
                <button
                  key={f.value}
                  onClick={() => setDecisionFilter(f.value)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    border: 'none',
                    borderRight: i < arr.length - 1 ? '0.5px solid var(--color-border)' : 'none',
                    background:
                      decisionFilter === f.value ? 'var(--color-bg-raised)' : 'transparent',
                    color:
                      decisionFilter === f.value
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-muted)',
                    fontSize: 12,
                    fontWeight: decisionFilter === f.value ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {tabLoading && (
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading...</span>
            )}
          </div>

          {filteredDecisions.length === 0 && !tabLoading ? (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '48px 0',
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}
            >
              {decisionFilter === 'actions'
                ? 'No buy or sell decisions on this page. Try switching to "Show all".'
                : 'No decisions found.'}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
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
                  {filteredDecisions.map((d) => {
                    const isExpanded = expandedDecisionIds.has(d.id)
                    const detail = expandedDecisionData[d.id]
                    return (
                      <>
                        <tr
                          key={d.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => toggleDecision(d.id)}
                        >
                          <td style={{ paddingLeft: 12 }}>
                            {isExpanded ? (
                              <ChevronDown size={13} style={{ color: 'var(--color-text-muted)' }} />
                            ) : (
                              <ChevronRight
                                size={13}
                                style={{ color: 'var(--color-text-muted)' }}
                              />
                            )}
                          </td>
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
                            <ActionBadge action={d.action} />
                          </td>
                          <td style={{ fontFamily: 'var(--font-code)' }}>{d.ticker ?? '—'}</td>
                          <td style={{ color: 'var(--color-text-secondary)' }}>
                            {d.quantity ?? '—'}
                          </td>
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
                              maxWidth: 260,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {d.reasoning}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${d.id}-detail`}>
                            <td
                              colSpan={8}
                              style={{
                                padding: '12px 24px 16px 52px',
                                background: 'var(--color-bg-surface)',
                                borderBottom: '0.5px solid var(--color-border)',
                              }}
                            >
                              {!detail ? (
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  Loading...
                                </div>
                              ) : (
                                <>
                                  <div className="section-label" style={{ marginBottom: 8 }}>
                                    claude reasoning
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 13,
                                      color: 'var(--color-text-secondary)',
                                      lineHeight: 1.6,
                                      whiteSpace: 'pre-wrap',
                                      marginBottom: 12,
                                    }}
                                  >
                                    {detail.reasoning}
                                  </div>
                                  {Array.isArray(detail.signals) && detail.signals.length > 0 && (
                                    <>
                                      <div className="section-label" style={{ marginBottom: 8 }}>
                                        signals at decision time
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {(
                                          detail.signals as Array<{
                                            ticker: string
                                            signal: SignalType
                                          }>
                                        ).map((s) => (
                                          <div
                                            key={s.ticker}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 6,
                                            }}
                                          >
                                            <span
                                              style={{
                                                fontSize: 12,
                                                fontFamily: 'var(--font-code)',
                                              }}
                                            >
                                              {s.ticker}
                                            </span>
                                            <SignalBadge signal={s.signal} />
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {decisions && decisions.totalPages > 1 && (
            <Pagination page={dPage} totalPages={decisions.totalPages} onPage={setDPage} />
          )}
        </div>
      )}

      {/* ── Orders tab ── */}
      {activeTab === 'orders' && (
        <div>
          {tabLoading && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Loading...
            </div>
          )}

          {orders && orders.data.length === 0 && !tabLoading ? (
            <div
              className="card"
              style={{
                textAlign: 'center',
                padding: '48px 0',
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}
            >
              No orders yet.
            </div>
          ) : orders && orders.data.length > 0 ? (
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
                        <td>
                          {o.t212OrderId ? (
                            <button
                              onClick={() => copyOrderId(o.t212OrderId!)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontFamily: 'var(--font-code)',
                                fontSize: 11,
                                background: 'var(--color-bg-raised)',
                                border: '0.5px solid var(--color-border)',
                                borderRadius: 4,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                color:
                                  copiedOrderId === o.t212OrderId
                                    ? '#16a34a'
                                    : 'var(--color-text-muted)',
                                transition: 'color 150ms ease',
                              }}
                            >
                              {copiedOrderId === o.t212OrderId ? (
                                <>
                                  <Check size={11} />
                                  copied
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  {o.t212OrderId.slice(0, 14)}…
                                </>
                              )}
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {orders.totalPages > 1 && (
                <Pagination page={oPage} totalPages={orders.totalPages} onPage={setOPage} />
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
