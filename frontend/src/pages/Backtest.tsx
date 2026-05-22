import { useEffect, useState, useCallback } from 'react'
import { Plus, ChevronDown, ChevronRight, RefreshCw, Trash2, Copy } from 'lucide-react'
import { api, type Backtest, type BacktestConfig } from '../api/client'
import NewBacktestModal from '../components/NewBacktestModal'
import { pushToast } from '../components/Toasts'

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—'
  const s = `${v > 0 ? '+' : ''}${v.toFixed(decimals)}%`
  return s
}

function fmtEur(v: number | null | undefined): string {
  return v == null ? '—' : `€${v.toFixed(2)}`
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  return v == null ? '—' : v.toFixed(decimals)
}

function StatusBadge({ status }: { status: Backtest['status'] }) {
  const colorMap: Record<Backtest['status'], { bg: string; fg: string }> = {
    pending: { bg: 'rgba(202,138,4,0.15)', fg: '#ca8a04' },
    running: { bg: 'rgba(37,99,235,0.15)', fg: 'var(--color-accent)' },
    completed: { bg: 'rgba(22,163,74,0.15)', fg: '#16a34a' },
    failed: { bg: 'rgba(220,38,38,0.15)', fg: '#dc2626' },
  }
  const { bg, fg } = colorMap[status]
  return (
    <span
      className="badge"
      style={{
        background: bg,
        color: fg,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {status}
    </span>
  )
}

function EquitySparkline({ points }: { points: Array<{ t: number; value: number }> }) {
  if (points.length < 2)
    return <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>—</div>
  const W = 280
  const H = 60
  const xs = points.map((p) => p.t)
  const ys = points.map((p) => p.value)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sx = (x: number) => ((x - minX) / (maxX - minX || 1)) * (W - 2) + 1
  const sy = (y: number) => H - (((y - minY) / (maxY - minY || 1)) * (H - 2) + 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.t).toFixed(1)} ${sy(p.value).toFixed(1)}`)
    .join(' ')
  const end = points[points.length - 1].value
  const start = points[0].value
  const color = end >= start ? '#16a34a' : '#dc2626'
  return (
    <svg width={W} height={H} style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function TradeTable({ trades }: { trades: NonNullable<Backtest['metricsJson']>['trades'] }) {
  if (trades.length === 0) {
    return (
      <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
        No trades executed in this run.
      </div>
    )
  }
  return (
    <div
      style={{
        marginTop: 10,
        maxHeight: 240,
        overflow: 'auto',
        border: '0.5px solid var(--color-border)',
        borderRadius: 4,
      }}
    >
      <table style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-code)' }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-page)' }}>
          <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>Ticker</th>
            <th style={{ padding: 6 }}>Opened</th>
            <th style={{ padding: 6 }}>Closed</th>
            <th style={{ padding: 6 }}>Entry</th>
            <th style={{ padding: 6 }}>Exit</th>
            <th style={{ padding: 6 }}>Qty</th>
            <th style={{ padding: 6 }}>P&L</th>
            <th style={{ padding: 6 }}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} style={{ borderTop: '0.5px solid var(--color-border)' }}>
              <td style={{ padding: 6 }}>{t.ticker}</td>
              <td style={{ padding: 6 }}>{t.openedAt.slice(0, 16).replace('T', ' ')}</td>
              <td style={{ padding: 6 }}>{t.closedAt.slice(0, 16).replace('T', ' ')}</td>
              <td style={{ padding: 6 }}>{fmtNum(t.entryPrice)}</td>
              <td style={{ padding: 6 }}>{fmtNum(t.exitPrice)}</td>
              <td style={{ padding: 6 }}>{fmtNum(t.quantity, 4)}</td>
              <td style={{ padding: 6, color: t.realizedPnl >= 0 ? '#16a34a' : '#dc2626' }}>
                {fmtEur(t.realizedPnl)}
              </td>
              <td style={{ padding: 6, color: 'var(--color-text-muted)' }}>{t.exitReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BacktestRow({
  row,
  expanded,
  onToggle,
  onDeleted,
  onRerun,
}: {
  row: Backtest
  expanded: boolean
  onToggle: () => void
  onDeleted: () => void
  onRerun: (cfg: BacktestConfig) => void
}) {
  const [details, setDetails] = useState<Backtest | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded || row.status !== 'completed' || details?.id === row.id) return
    setLoading(true)
    api.backtests
      .get(row.id)
      .then(setDetails)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [expanded, row.id, row.status, details])

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete backtest "${row.name}"?`)) return
    try {
      await api.backtests.delete(row.id)
      onDeleted()
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  const period = `${row.startDate} → ${row.endDate}`
  const returnColor =
    row.totalReturnPct == null
      ? 'var(--color-text-muted)'
      : row.totalReturnPct >= 0
        ? '#16a34a'
        : '#dc2626'

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ padding: '8px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
            )}
            <span style={{ fontWeight: 500 }}>{row.name}</span>
          </div>
        </td>
        <td style={{ padding: '8px 6px', fontFamily: 'var(--font-code)', fontSize: 12 }}>
          {period}
        </td>
        <td style={{ padding: '8px 6px' }}>
          <StatusBadge status={row.status} />
          {row.status === 'running' && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
              {row.progressPct}%
            </span>
          )}
        </td>
        <td style={{ padding: '8px 6px', fontFamily: 'var(--font-code)', color: returnColor }}>
          {fmtPct(row.totalReturnPct)}
        </td>
        <td style={{ padding: '8px 6px', fontFamily: 'var(--font-code)' }}>
          {row.winRate != null ? `${(row.winRate * 100).toFixed(0)}%` : '—'}
        </td>
        <td style={{ padding: '8px 6px', fontFamily: 'var(--font-code)' }}>
          {row.tradesCount ?? '—'}
        </td>
        <td style={{ padding: '8px 6px', fontSize: 11, color: 'var(--color-text-muted)' }}>
          {new Date(row.createdAt).toLocaleString()}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRerun(row.configJson)
            }}
            title="Rerun with edits"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: 4,
            }}
          >
            <Copy size={13} />
          </button>
          <button
            onClick={handleDelete}
            title="Delete"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: 4,
            }}
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--color-bg-surface)', padding: 16 }}>
            {row.status === 'failed' && (
              <div style={{ fontSize: 12, color: '#dc2626' }}>
                Failed: {row.errorMessage ?? 'unknown error'}
              </div>
            )}
            {row.status !== 'failed' && row.status !== 'completed' && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Running… {row.progressPct}% complete
              </div>
            )}
            {row.status === 'completed' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  <Metric label="Initial" value={fmtEur(row.initialCash)} />
                  <Metric label="Final" value={fmtEur(row.finalValue)} />
                  <Metric
                    label="Realized P&L"
                    value={fmtEur(row.realizedPnl)}
                    positive={(row.realizedPnl ?? 0) >= 0}
                  />
                  <Metric
                    label="Return"
                    value={fmtPct(row.totalReturnPct)}
                    positive={(row.totalReturnPct ?? 0) >= 0}
                  />
                  <Metric
                    label="Max DD"
                    value={fmtPct(row.maxDrawdownPct ? -row.maxDrawdownPct : 0)}
                  />
                  <Metric
                    label="Win rate"
                    value={row.winRate != null ? `${(row.winRate * 100).toFixed(0)}%` : '—'}
                  />
                  <Metric label="Trades" value={row.tradesCount?.toString() ?? '—'} />
                  <Metric label="Sharpe" value={fmtNum(row.sharpe)} />
                </div>
                <div>
                  <div className="section-label" style={{ marginBottom: 6 }}>
                    Equity curve
                  </div>
                  {details?.metricsJson?.equityCurve ? (
                    <EquitySparkline points={details.metricsJson.equityCurve} />
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {loading ? 'Loading…' : 'Expand to load chart'}
                    </div>
                  )}
                </div>
                {details?.metricsJson?.trades && <TradeTable trades={details.metricsJson.trades} />}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontFamily: 'var(--font-code)',
          color:
            positive === true
              ? '#16a34a'
              : positive === false
                ? '#dc2626'
                : 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

export default function BacktestPage() {
  const [rows, setRows] = useState<Backtest[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [rerunPrefill, setRerunPrefill] = useState<Partial<BacktestConfig> | undefined>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.backtests.list(1, 50)
      setRows(res.data)
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll while any row is pending/running
  useEffect(() => {
    const anyActive = rows.some((r) => r.status === 'pending' || r.status === 'running')
    if (!anyActive) return
    const id = setInterval(() => {
      void load()
    }, 3000)
    return () => clearInterval(id)
  }, [rows, load])

  function handleOpenNew() {
    setRerunPrefill(undefined)
    setModalOpen(true)
  }

  function handleRerun(cfg: BacktestConfig) {
    setRerunPrefill({ ...cfg, name: `${cfg.name} (rerun)` })
    setModalOpen(true)
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Backtest</h1>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Replay the trading algorithm against historical hourly data — no Claude AI calls,
            deterministic decisions.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={load}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={handleOpenNew}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={13} />
            New backtest
          </button>
        </div>
      </div>

      <div
        style={{
          border: '0.5px solid var(--color-border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'var(--color-bg-surface)' }}>
            <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Period</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Return</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Win rate</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Trades</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }}>Created</th>
              <th style={{ padding: '10px 6px', fontWeight: 500 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  No backtests yet — click <strong>New backtest</strong> to run your first one.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <BacktestRow
                key={r.id}
                row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onDeleted={load}
                onRerun={handleRerun}
              />
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <NewBacktestModal
          prefill={rerunPrefill}
          onClose={() => setModalOpen(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}
