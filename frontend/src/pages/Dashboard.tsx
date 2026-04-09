import { useEffect, useState, useCallback, useRef } from 'react'
import { Play, Square, RefreshCw } from 'lucide-react'
import { api, type EngineStatus, type Portfolio, type DailySnapshot, type Decision } from '../api/client'
import StatCard from '../components/StatCard'
import MarketClock from '../components/MarketClock'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

function fmt(n: number | null | undefined, decimals = 2, prefix = '') {
  if (n == null) return '—'
  return `${prefix}${n.toFixed(decimals)}`
}
function fmtEur(n: number | null | undefined) { return fmt(n, 2, '€') }
function fmtPct(n: number | null | undefined) { return fmt(n, 2, '') + '%' }

function EngineCard({ status, onStart, onStop, onCycle, loading }: {
  status: EngineStatus | null
  onStart: () => void
  onStop: () => void
  onCycle: () => void
  loading: boolean
}) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      {/* Top row: engine state + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
              borderRadius: 9999, fontSize: 11, fontWeight: 500,
              background: status?.running ? 'rgba(22,163,74,0.12)' : 'var(--color-bg-raised)',
              color: status?.running ? '#16a34a' : 'var(--color-text-muted)',
            }}
          >
            {status?.running ? '● running' : '○ stopped'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {status?.mode?.toUpperCase() ?? '—'} · {status ? Math.round(status.intervalMs / 60000) : '—'}min interval
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCycle} disabled={loading} title="Trigger single cycle">
            <RefreshCw size={13} />
            cycle
          </button>
          {status?.running
            ? <button className="btn btn-secondary" onClick={onStop} disabled={loading}><Square size={13} />Stop</button>
            : <button className="btn btn-primary" onClick={onStart} disabled={loading}><Play size={13} />Start</button>
          }
        </div>
      </div>

      {/* Market clock */}
      <MarketClock />

      {/* Cycle timestamps */}
      {(status?.lastCycleAt || status?.nextCycleAt) && (
        <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
          {status?.lastCycleAt && (
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>last cycle</div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-code)', color: 'var(--color-text-secondary)' }}>
                {new Date(status.lastCycleAt).toLocaleTimeString()}
              </div>
            </div>
          )}
          {status?.nextCycleAt && (
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>next cycle</div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-code)', color: 'var(--color-text-secondary)' }}>
                {new Date(status.nextCycleAt).toLocaleTimeString()}
              </div>
            </div>
          )}
          <div>
            <div className="section-label" style={{ marginBottom: 2 }}>cycles run</div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-code)', color: 'var(--color-text-secondary)' }}>
              {status?.cycleCount ?? 0}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [maxBudget, setMaxBudget] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [positionsRefreshing, setPositionsRefreshing] = useState(false)
  const [instrumentNames, setInstrumentNames] = useState<Record<string, string>>({})
  const instrumentNamesRef = useRef(instrumentNames)
  useEffect(() => { instrumentNamesRef.current = instrumentNames }, [instrumentNames])

  const fetchMissingNames = useCallback(async (tickers: string[]) => {
    const unknown = tickers.filter((t) => !(t in instrumentNamesRef.current))
    if (unknown.length === 0) return
    const results = await Promise.all(
      unknown.map(async (t) => {
        // Try exact ticker first, then fall back to base symbol (strip suffix)
        let inst = await api.instruments.lookup(t)
        if (!inst) {
          const base = t.replace(/_US_EQ$|_GB_EQ$|_EQ$/, '')
          const res = await api.instruments.search(base)
          inst = res.data.find((i) => i.ticker === t) ?? res.data[0] ?? null
        }
        return inst
      })
    )
    setInstrumentNames((prev) => {
      const next = { ...prev }
      unknown.forEach((t, i) => {
        next[t] = results[i]?.shortName ?? results[i]?.name ?? t.replace(/_US_EQ$|_GB_EQ$|_EQ$/, '')
      })
      return next
    })
  }, [])

  const loadPositions = useCallback(async () => {
    setPositionsRefreshing(true)
    try {
      const port = await api.portfolio.get()
      setPortfolio(port)
      await fetchMissingNames(port.aiPositions.map((p) => p.ticker))
    } catch {
      // don't clobber the main error
    } finally {
      setPositionsRefreshing(false)
    }
  }, [fetchMissingNames])

  const loadData = useCallback(async () => {
    try {
      const [status, port, snaps, decs, cfg] = await Promise.all([
        api.engine.status(),
        api.portfolio.get(),
        api.analytics.snapshots(30),
        api.decisions.list(1, 10),
        api.config.get(),
      ])
      setEngineStatus(status)
      setPortfolio(port)
      setSnapshots(snaps.data)
      setDecisions(decs.data)
      setMaxBudget(cfg.maxBudgetEur)
      // Fetch names immediately on initial load
      fetchMissingNames(port.aiPositions.map((p) => p.ticker))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [fetchMissingNames])

  useEffect(() => { loadData() }, [loadData])

  const handleStart = async () => { setLoading(true); try { setEngineStatus(await api.engine.start()) } finally { setLoading(false) } }
  const handleStop = async () => { setLoading(true); try { setEngineStatus(await api.engine.stop()) } finally { setLoading(false) } }
  const handleCycle = async () => { setLoading(true); try { setEngineStatus(await api.engine.cycle()); await loadData() } finally { setLoading(false) } }

  // AI-only portfolio stats derived from open AI positions + live prices
  const aiStats = (() => {
    if (!portfolio) return null
    const positions = portfolio.aiPositions
    let invested = 0
    let currentValue = 0
    for (const ai of positions) {
      const costBasis = (ai.entryPrice ?? 0) * ai.quantity
      const live = portfolio.positions.find((p) => p.ticker === ai.ticker)
      const liveValue = live ? live.currentPrice * ai.quantity : costBasis
      invested += costBasis
      currentValue += liveValue
    }
    const pnl = currentValue - invested
    const budgetRemaining = maxBudget != null ? maxBudget - invested : null
    return { invested, currentValue, pnl, budgetRemaining }
  })()
  const snapshotData = snapshots.map((s) => ({
    date: s.date.slice(5), // MM-DD
    value: Number(s.value.toFixed(2)),
  }))

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Hi Louis</h1>
        {error && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{error}</div>}
      </div>

      <EngineCard
        status={engineStatus}
        onStart={handleStart}
        onStop={handleStop}
        onCycle={handleCycle}
        loading={loading}
      />

      {/* Stats row — AI portfolio only */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="AI value" value={fmtEur(aiStats?.currentValue)} />
        <StatCard label="AI invested" value={fmtEur(aiStats?.invested)} />
        <StatCard label="Budget remaining" value={fmtEur(aiStats?.budgetRemaining)} />
        <StatCard
          label="Unrealised P&L"
          value={fmtEur(aiStats?.pnl)}
          positive={aiStats != null && aiStats.pnl > 0}
          negative={aiStats != null && aiStats.pnl < 0}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Portfolio chart */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 16 }}>AI portfolio value — 30d</div>
          {snapshotData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={snapshotData}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `€${v}`} width={48} />
                <Tooltip
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'Value']}
                  contentStyle={{
                    background: 'var(--color-bg-surface)',
                    border: '0.5px solid var(--color-border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              No snapshot data yet
            </div>
          )}
        </div>

        {/* AI-tracked positions only */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="section-label">ai positions</span>
            <button
              className="btn btn-ghost"
              style={{ padding: '0 6px', height: 24 }}
              onClick={() => loadPositions(false)}
              disabled={positionsRefreshing}
              title="Refresh positions"
            >
              <RefreshCw size={12} style={{ transition: 'transform 0.4s', transform: positionsRefreshing ? 'rotate(360deg)' : 'none' }} />
            </button>
          </div>
          {portfolio?.aiPositions.length ? (() => {
            // Aggregate multiple lots of the same ticker into one row
            const grouped = portfolio.aiPositions.reduce<Record<string, {
              ticker: string; totalQty: number; weightedEntrySum: number
            }>>((acc, ai) => {
              if (!acc[ai.ticker]) acc[ai.ticker] = { ticker: ai.ticker, totalQty: 0, weightedEntrySum: 0 }
              acc[ai.ticker].totalQty += ai.quantity
              acc[ai.ticker].weightedEntrySum += (ai.entryPrice ?? 0) * ai.quantity
              return acc
            }, {})

            return (
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th style={{ textAlign: 'right' }}>Avg Entry</th>
                    <th style={{ textAlign: 'right' }}>Current</th>
                    <th style={{ textAlign: 'right' }}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(grouped).map(({ ticker, totalQty, weightedEntrySum }) => {
                    const avgEntry = totalQty > 0 ? weightedEntrySum / totalQty : null
                    const live = portfolio.positions.find((p) => p.ticker === ticker)
                    const currentPrice = live?.currentPrice ?? null
                    const pnl = currentPrice != null && avgEntry != null
                      ? (currentPrice - avgEntry) * totalQty
                      : null
                    const pct = currentPrice != null && avgEntry != null && avgEntry > 0
                      ? ((currentPrice - avgEntry) / avgEntry) * 100
                      : null
                    const displayTicker = ticker.replace(/_US_EQ$|_GB_EQ$|_EQ$/, '')
                    const name = instrumentNames[ticker]
                    return (
                      <tr key={ticker}>
                        <td>
                          <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{displayTicker}</span>
                          {name && name !== displayTicker && (
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{name}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                          {avgEntry != null ? `€${avgEntry.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                          {currentPrice != null ? `€${currentPrice.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', color: pnl == null ? 'var(--color-text-muted)' : pnl >= 0 ? '#16a34a' : '#dc2626' }}>
                          {pnl != null ? `${pnl >= 0 ? '+' : ''}€${pnl.toFixed(2)}` : '—'}
                          {pct != null && (
                            <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.8 }}>
                              ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })() : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingTop: 8 }}>No AI positions open</div>
          )}
        </div>
      </div>

      {/* Recent decisions */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="section-label">recent decisions</div>
        </div>
        {decisions.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Ticker</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {new Date(d.timestamp).toLocaleString()}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: '2px 6px', borderRadius: 9999,
                      background: d.action === 'buy' ? 'rgba(22,163,74,0.1)' : d.action === 'sell' ? 'rgba(220,38,38,0.1)' : 'var(--color-bg-raised)',
                      color: d.action === 'buy' ? '#16a34a' : d.action === 'sell' ? '#dc2626' : 'var(--color-text-muted)',
                    }}>
                      {d.action.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-code)' }}>{d.ticker ? d.ticker.replace(/_US_EQ$|_EQ$/, '') : '—'}</td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>{d.quantity ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {d.orderStatus ? (d.orderStatus.startsWith('blocked') ? '⚠ blocked' : d.orderStatus.startsWith('error') ? '✗ error' : '✓ ' + d.orderStatus) : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.reasoning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No decisions yet</div>
        )}
      </div>

    </div>
  )
}
