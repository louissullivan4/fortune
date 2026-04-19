import { useEffect, useState, useCallback, useRef } from 'react'
import { Play, Square, RefreshCw, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, type EngineStatus, type Portfolio, type Summary } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MarketClock from '../components/MarketClock'
import ExportReportModal from '../components/ExportReportModal'

function fmt(n: number | null | undefined, decimals = 2, prefix = '') {
  if (n == null) return '—'
  return `${prefix}${n.toFixed(decimals)}`
}
function fmtEur(n: number | null | undefined) {
  return fmt(n, 2, '€')
}
function _fmtPct(n: number | null | undefined) {
  return fmt(n, 2, '') + '%'
}

function EngineCard({
  status,
  onStart,
  onStop,
  onCycle,
  onExport,
  loading,
}: {
  status: EngineStatus | null
  onStart: () => void
  onStop: () => void
  onCycle: () => void
  onExport: () => void
  loading: boolean
}) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      {/* Top row: engine state + controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 8px',
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 500,
              background: status?.running ? 'rgba(22,163,74,0.12)' : 'var(--color-bg-raised)',
              color: status?.running ? '#16a34a' : 'var(--color-text-muted)',
            }}
          >
            {status?.running ? '● running' : '○ stopped'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {status?.mode?.toUpperCase() ?? '—'} ·{' '}
            {status ? Math.round(status.intervalMs / 60000) : '—'}min interval
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={onExport}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Download size={13} />
            Export
          </button>
          <button
            className="btn btn-ghost"
            onClick={onCycle}
            disabled={loading}
            title="Trigger single cycle"
          >
            <RefreshCw size={13} />
            cycle
          </button>
          {status?.running ? (
            <button className="btn btn-secondary" onClick={onStop} disabled={loading}>
              <Square size={13} />
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onStart} disabled={loading}>
              <Play size={13} />
              Start
            </button>
          )}
        </div>
      </div>

      {/* Market clock */}
      <MarketClock />

      {/* Cycle timestamps */}
      {(status?.lastCycleAt || status?.nextCycleAt) && (
        <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
          {status?.lastCycleAt && (
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>
                last cycle
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-code)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {new Date(status.lastCycleAt).toLocaleTimeString()}
              </div>
            </div>
          )}
          {status?.nextCycleAt && (
            <div>
              <div className="section-label" style={{ marginBottom: 2 }}>
                next cycle
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-code)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {new Date(status.nextCycleAt).toLocaleTimeString()}
              </div>
            </div>
          )}
          <div>
            <div className="section-label" style={{ marginBottom: 2 }}>
              cycles run
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-code)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {status?.cycleCount ?? 0}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Overview() {
  const { user } = useAuth()
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [_maxBudget, setMaxBudget] = useState<number | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [positionsRefreshing, setPositionsRefreshing] = useState(false)
  const [aiPage, setAiPage] = useState(1)
  const [manualPage, setManualPage] = useState(1)
  const [instrumentNames, setInstrumentNames] = useState<Record<string, string>>({})
  const instrumentNamesRef = useRef(instrumentNames)
  useEffect(() => {
    instrumentNamesRef.current = instrumentNames
  }, [instrumentNames])

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
      await fetchMissingNames([
        ...port.aiPositions.map((p) => p.ticker),
        ...port.manualPositions.map((p) => p.ticker),
      ])
    } catch {
      // don't clobber the main error
    } finally {
      setPositionsRefreshing(false)
    }
  }, [fetchMissingNames])

  const loadData = useCallback(async () => {
    try {
      const [status, port, cfg, sum] = await Promise.all([
        api.engine.status(),
        api.portfolio.get(),
        api.config.get(),
        api.analytics.summary(),
      ])
      setEngineStatus(status)
      setPortfolio(port)
      setMaxBudget(cfg.maxBudgetEur)
      setSummary(sum)
      fetchMissingNames([
        ...port.aiPositions.map((p) => p.ticker),
        ...port.manualPositions.map((p) => p.ticker),
      ])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [fetchMissingNames])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleStart = async () => {
    setLoading(true)
    try {
      setEngineStatus(await api.engine.start())
    } finally {
      setLoading(false)
    }
  }
  const handleStop = async () => {
    setLoading(true)
    try {
      setEngineStatus(await api.engine.stop())
    } finally {
      setLoading(false)
    }
  }
  const handleCycle = async () => {
    setLoading(true)
    try {
      setEngineStatus(await api.engine.cycle())
      await loadData()
    } finally {
      setLoading(false)
    }
  }

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
    const pendingSettlement = engineStatus?.pendingSettlement ?? 0
    const freeCash = Math.max(0, portfolio.cash.free - pendingSettlement)
    return { invested, currentValue, pnl, freeCash, pendingSettlement }
  })()
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
          Hi{' '}
          {user?.firstName
            ? user.firstName.charAt(0).toUpperCase() + user.firstName.slice(1).toLowerCase()
            : ''}
        </h1>
        {error && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{error}</div>}
      </div>

      <EngineCard
        status={engineStatus}
        onStart={handleStart}
        onStop={handleStop}
        onCycle={handleCycle}
        onExport={() => setShowExportModal(true)}
        loading={loading}
      />
      {showExportModal && <ExportReportModal onClose={() => setShowExportModal(false)} />}

      {/* Stats row — two summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {/* Card 1: Portfolio snapshot */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 8 }}>
            portfolio
          </div>

          {/* Primary metric */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>
              AI Value
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.5px',
                fontFamily: 'var(--font-code)',
                color: 'var(--color-text-primary)',
                lineHeight: 1.2,
              }}
            >
              {fmtEur(aiStats?.currentValue)}
            </div>
          </div>

          <div style={{ height: '0.5px', background: 'var(--color-border)', marginBottom: 8 }} />

          {/* Secondary metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                Invested
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'var(--font-code)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {fmtEur(aiStats?.invested)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                Free Cash
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'var(--font-code)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {fmtEur(aiStats?.freeCash)}
              </div>
              {aiStats != null && aiStats.pendingSettlement > 0 && (
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                  +€{aiStats.pendingSettlement.toFixed(2)} pending
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Returns breakdown */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 8 }}>
            returns
          </div>

          {/* Unrealised */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 7,
            }}
          >
            <div>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                Unrealised P&L
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 5 }}>
                open
              </span>
            </div>
            <span
              style={{
                fontSize: 13,
                fontFamily: 'var(--font-code)',
                fontWeight: 500,
                color:
                  aiStats == null
                    ? 'var(--color-text-muted)'
                    : aiStats.pnl >= 0
                      ? '#16a34a'
                      : '#dc2626',
              }}
            >
              {aiStats == null ? '—' : `${aiStats.pnl >= 0 ? '+' : ''}€${aiStats.pnl.toFixed(2)}`}
            </span>
          </div>

          {/* Realised */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 8,
            }}
          >
            <div>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                Realised P&L
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 5 }}>
                closed
              </span>
            </div>
            <span
              style={{
                fontSize: 13,
                fontFamily: 'var(--font-code)',
                fontWeight: 500,
                color:
                  summary == null
                    ? 'var(--color-text-muted)'
                    : (summary.realizedPnl ?? 0) >= 0
                      ? '#16a34a'
                      : '#dc2626',
              }}
            >
              {summary == null
                ? '—'
                : `${(summary.realizedPnl ?? 0) >= 0 ? '+' : ''}€${(summary.realizedPnl ?? 0).toFixed(2)}`}
            </span>
          </div>

          <div style={{ height: '0.5px', background: 'var(--color-border)', marginBottom: 8 }} />

          {/* Est. Tax */}
          {(() => {
            const TAX_RATE = 0.33
            const realised = summary?.realizedPnl ?? 0
            const tax = Math.max(0, realised) * TAX_RATE
            const afterTax = realised - tax
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Est. Tax</span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--color-text-muted)',
                        marginLeft: 4,
                        opacity: 0.65,
                      }}
                    >
                      33% CGT
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontFamily: 'var(--font-code)',
                      color: tax > 0 ? '#dc2626' : 'var(--color-text-muted)',
                    }}
                  >
                    {summary == null ? '—' : tax > 0 ? `-€${tax.toFixed(2)}` : '€0.00'}
                  </span>
                </div>

                <div
                  style={{ height: '0.5px', background: 'var(--color-border)', marginBottom: 8 }}
                />

                {/* After-tax profit */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}
                  >
                    After-tax Profit
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      fontFamily: 'var(--font-code)',
                      fontWeight: 700,
                      letterSpacing: '-0.5px',
                      color:
                        summary == null
                          ? 'var(--color-text-muted)'
                          : afterTax >= 0
                            ? '#16a34a'
                            : '#dc2626',
                    }}
                  >
                    {summary == null ? '—' : `${afterTax >= 0 ? '+' : ''}€${afterTax.toFixed(2)}`}
                  </span>
                </div>
              </>
            )
          })()}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* AI positions */}
        <div className="card">
          {(() => {
            const PAGE_SIZE = 10
            const grouped = Object.values(
              (portfolio?.aiPositions ?? []).reduce<
                Record<string, { ticker: string; totalQty: number; weightedEntrySum: number }>
              >((acc, ai) => {
                if (!acc[ai.ticker])
                  acc[ai.ticker] = { ticker: ai.ticker, totalQty: 0, weightedEntrySum: 0 }
                acc[ai.ticker].totalQty += ai.quantity
                acc[ai.ticker].weightedEntrySum += (ai.entryPrice ?? 0) * ai.quantity
                return acc
              }, {})
            )
            const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE))
            const safePage = Math.min(aiPage, totalPages)
            const pageRows = grouped.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <span className="section-label">ai positions</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {totalPages > 1 && (
                      <>
                        <span
                          style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 2 }}
                        >
                          {safePage}/{totalPages}
                        </span>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', height: 24 }}
                          onClick={() => setAiPage((p) => Math.max(1, p - 1))}
                          disabled={safePage === 1}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', height: 24 }}
                          onClick={() => setAiPage((p) => Math.min(totalPages, p + 1))}
                          disabled={safePage === totalPages}
                        >
                          <ChevronRight size={12} />
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '0 6px', height: 24 }}
                      onClick={() => loadPositions()}
                      disabled={positionsRefreshing}
                      title="Refresh positions"
                    >
                      <RefreshCw
                        size={12}
                        style={{
                          transition: 'transform 0.4s',
                          transform: positionsRefreshing ? 'rotate(360deg)' : 'none',
                        }}
                      />
                    </button>
                  </div>
                </div>
                {grouped.length ? (
                  <div className="table-wrap">
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
                        {pageRows.map(({ ticker, totalQty, weightedEntrySum }) => {
                          const avgEntry = totalQty > 0 ? weightedEntrySum / totalQty : null
                          const live = portfolio!.positions.find((p) => p.ticker === ticker)
                          const currentPrice = live?.currentPrice ?? null
                          const pnl =
                            currentPrice != null && avgEntry != null
                              ? (currentPrice - avgEntry) * totalQty
                              : null
                          const pct =
                            currentPrice != null && avgEntry != null && avgEntry > 0
                              ? ((currentPrice - avgEntry) / avgEntry) * 100
                              : null
                          const displayTicker = ticker.replace(/_US_EQ$|_GB_EQ$|_EQ$/, '')
                          const name = instrumentNames[ticker]
                          return (
                            <tr key={ticker}>
                              <td>
                                <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>
                                  {displayTicker}
                                </span>
                                {name && name !== displayTicker && (
                                  <span
                                    style={{
                                      display: 'block',
                                      fontSize: 11,
                                      color: 'var(--color-text-muted)',
                                      marginTop: 1,
                                    }}
                                  >
                                    {name}
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                                {avgEntry != null ? `€${avgEntry.toFixed(2)}` : '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                                {currentPrice != null ? `€${currentPrice.toFixed(2)}` : '—'}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  color:
                                    pnl == null
                                      ? 'var(--color-text-muted)'
                                      : pnl >= 0
                                        ? '#16a34a'
                                        : '#dc2626',
                                }}
                              >
                                {pnl != null ? `${pnl >= 0 ? '+' : ''}€${pnl.toFixed(2)}` : '—'}
                                {pct != null && (
                                  <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.8 }}>
                                    ({pct >= 0 ? '+' : ''}
                                    {pct.toFixed(1)}%)
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingTop: 8 }}>
                    No AI positions open
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Manual positions */}
        <div className="card">
          {(() => {
            const PAGE_SIZE = 10
            const rows = portfolio?.manualPositions ?? []
            const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
            const safePage = Math.min(manualPage, totalPages)
            const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <span className="section-label">manual positions</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {totalPages > 1 && (
                      <>
                        <span
                          style={{ fontSize: 11, color: 'var(--color-text-muted)', marginRight: 2 }}
                        >
                          {safePage}/{totalPages}
                        </span>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', height: 24 }}
                          onClick={() => setManualPage((p) => Math.max(1, p - 1))}
                          disabled={safePage === 1}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', height: 24 }}
                          onClick={() => setManualPage((p) => Math.min(totalPages, p + 1))}
                          disabled={safePage === totalPages}
                        >
                          <ChevronRight size={12} />
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '0 6px', height: 24 }}
                      onClick={() => loadPositions()}
                      disabled={positionsRefreshing}
                      title="Refresh positions"
                    >
                      <RefreshCw
                        size={12}
                        style={{
                          transition: 'transform 0.4s',
                          transform: positionsRefreshing ? 'rotate(360deg)' : 'none',
                        }}
                      />
                    </button>
                  </div>
                </div>
                {rows.length ? (
                  <div className="table-wrap">
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
                        {pageRows.map((pos) => {
                          const pct =
                            pos.averagePrice > 0
                              ? ((pos.currentPrice - pos.averagePrice) / pos.averagePrice) * 100
                              : null
                          const displayTicker = pos.ticker.replace(/_US_EQ$|_GB_EQ$|_EQ$/, '')
                          const name = instrumentNames[pos.ticker]
                          return (
                            <tr key={pos.ticker}>
                              <td>
                                <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>
                                  {displayTicker}
                                </span>
                                {name && name !== displayTicker && (
                                  <span
                                    style={{
                                      display: 'block',
                                      fontSize: 11,
                                      color: 'var(--color-text-muted)',
                                      marginTop: 1,
                                    }}
                                  >
                                    {name}
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                                €{pos.averagePrice.toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                                €{pos.currentPrice.toFixed(2)}
                              </td>
                              <td
                                style={{
                                  textAlign: 'right',
                                  color: pos.ppl >= 0 ? '#16a34a' : '#dc2626',
                                }}
                              >
                                {pos.ppl >= 0 ? '+' : ''}€{pos.ppl.toFixed(2)}
                                {pct != null && (
                                  <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.8 }}>
                                    ({pct >= 0 ? '+' : ''}
                                    {pct.toFixed(1)}%)
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', paddingTop: 8 }}>
                    No manual positions
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
