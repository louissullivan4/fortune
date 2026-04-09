import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { api, type Summary, type Performance, type DailySnapshot, type IntradayPoint, type AiPosition, type AiCostResponse } from '../api/client'
import StatCard from '../components/StatCard'

function fmtEur(v: number | null | undefined) { return v == null ? '—' : `€${v.toFixed(2)}` }
function fmtPct(v: number | null | undefined) { return v == null ? '—' : `${v.toFixed(1)}%` }

// ── Range config ───────────────────────────────────────────────────────────

type RangeKey = '1H' | '1D' | '1W' | '2W' | '1M' | '3M' | 'All'

interface Range {
  label: RangeKey
  mode: 'intraday' | 'daily'
  hours?: number   // intraday
  days?: number    // daily (null = all)
}

const RANGES: Range[] = [
  { label: '1H',  mode: 'intraday', hours: 1 },
  { label: '1D',  mode: 'intraday', hours: 24 },
  { label: '1W',  mode: 'daily',    days: 7 },
  { label: '2W',  mode: 'daily',    days: 14 },
  { label: '1M',  mode: 'daily',    days: 30 },
  { label: '3M',  mode: 'daily',    days: 90 },
  { label: 'All', mode: 'daily' },
]

// Normalised chart point used by both modes
interface ChartPoint { label: string; value: number }

function toLabel(ts: string, mode: 'intraday' | 'daily'): string {
  const d = new Date(ts)
  if (mode === 'intraday') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function dailyToPoints(snapshots: DailySnapshot[], days?: number): ChartPoint[] {
  const slice = days == null ? snapshots : snapshots.slice(-days)
  return slice.map((s) => ({ label: s.date.slice(5), value: Number(s.value.toFixed(2)) }))
}

function intradayToPoints(points: IntradayPoint[]): ChartPoint[] {
  return points.map((p) => ({
    label: toLabel(p.timestamp, 'intraday'),
    value: p.value,
  }))
}

// ── Range selector ─────────────────────────────────────────────────────────

function RangeSelector({ value, onChange, availableDays }: {
  value: RangeKey
  onChange: (r: Range) => void
  availableDays: number
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map((r) => {
        const disabled = r.mode === 'daily' && r.days != null && availableDays < r.days
        const active = value === r.label
        return (
          <button
            key={r.label}
            disabled={disabled}
            onClick={() => onChange(r)}
            style={{
              height: 24, padding: '0 8px', borderRadius: 4,
              border: `0.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
              color: active ? 'var(--color-accent)' : disabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              fontSize: 11, fontWeight: active ? 500 : 400,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              transition: 'all 150ms ease',
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [performance, setPerformance] = useState<Performance | null>(null)
  const [allSnapshots, setAllSnapshots] = useState<DailySnapshot[]>([])
  const [positions, setPositions] = useState<{ open: AiPosition[]; closed: AiPosition[] } | null>(null)
  const [aiCost, setAiCost] = useState<AiCostResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [activeRange, setActiveRange] = useState<Range>(RANGES[4]) // default 1M
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)

  // Initial load
  useEffect(() => {
    Promise.all([
      api.analytics.summary(),
      api.analytics.performance(),
      api.analytics.snapshots(365),
      api.analytics.positions(),
      api.analytics.aiCost(),
    ]).then(([s, p, snaps, pos, ai]) => {
      setSummary(s)
      setPerformance(p)
      setAllSnapshots(snaps.data)
      setPositions(pos)
      setAiCost(ai)
      if (snaps.data.length < 30 && snaps.data.length > 0) {
        setActiveRange(RANGES.find((r) => r.label === '1W') ?? RANGES[4])
      }
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  // Load chart data whenever range or snapshots change
  const loadChart = useCallback(async (range: Range, snapshots: DailySnapshot[]) => {
    if (range.mode === 'daily') {
      setChartPoints(dailyToPoints(snapshots, range.days))
      return
    }
    setChartLoading(true)
    try {
      const res = await api.analytics.intraday(range.hours!)
      setChartPoints(intradayToPoints(res.data))
    } catch (e) {
      console.error(e)
      setChartPoints([])
    } finally {
      setChartLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!loading) loadChart(activeRange, allSnapshots)
  }, [activeRange, allSnapshots, loading, loadChart])

  const handleRangeChange = (r: Range) => setActiveRange(r)

  // Daily P&L bars — only meaningful for daily mode
  const pnlBars = activeRange.mode === 'daily'
    ? chartPoints.slice(1).map((p, i) => ({
        label: p.label,
        pnl: Number((p.value - chartPoints[i].value).toFixed(2)),
      }))
    : []

  const rangeLabel = activeRange.label === 'All'
    ? `All (${allSnapshots.length}d)`
    : activeRange.label

  if (loading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>

  const totalPnl = summary?.realizedPnl ?? null
  const winRate = performance?.winRate ?? null
  const totalAiCostUsd = aiCost?.summary.totalCostUsd ?? 0
  // Net P&L in EUR — AI cost converted at ~1.10 USD/EUR (rough; shown as note)
  const aiCostEur = totalAiCostUsd / 1.10
  const netPnl = totalPnl != null ? totalPnl - aiCostEur : null

  const fmtUsd = (v: number | null | undefined) => v == null ? '—' : `$${v.toFixed(4)}`
  const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n)

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 24px' }}>Analytics</h1>

      {/* P&L stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <StatCard
          label="Realized P&L (trades)"
          value={fmtEur(totalPnl)}
          sub="gross trade P&L in EUR"
          positive={(totalPnl ?? 0) > 0}
          negative={(totalPnl ?? 0) < 0}
        />
        <StatCard
          label="AI platform cost"
          value={`$${totalAiCostUsd.toFixed(4)}`}
          sub={`≈ €${aiCostEur.toFixed(4)} · ${summary?.aiCallCount ?? 0} calls`}
          negative={totalAiCostUsd > 0}
        />
        <StatCard
          label="Net P&L (after AI)"
          value={fmtEur(netPnl)}
          sub="trade P&L − AI cost (EUR)"
          positive={(netPnl ?? 0) > 0}
          negative={(netPnl ?? 0) < 0}
        />
        <StatCard label="Win rate" value={fmtPct(winRate)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total trades" value={summary?.totalTrades ?? '—'} />
        <StatCard label="Days traded" value={summary?.daysTraded ?? '—'} />
        <StatCard label="Avg win" value={fmtEur(performance?.avgWin)} positive={(performance?.avgWin ?? 0) > 0} />
        <StatCard label="Avg loss" value={fmtEur(performance?.avgLoss)} negative={(performance?.avgLoss ?? 0) < 0} />
      </div>

      {/* Portfolio value chart */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div className="section-label">AI portfolio value</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>— {rangeLabel}</div>
          </div>
          <RangeSelector
            value={activeRange.label}
            onChange={handleRangeChange}
            availableDays={allSnapshots.length}
          />
        </div>

        {chartLoading ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Loading...
          </div>
        ) : chartPoints.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartPoints}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `€${v}`} width={52} />
              <Tooltip
                formatter={(v: number) => [`€${v.toFixed(2)}`, 'Value']}
                labelFormatter={(l) => activeRange.mode === 'intraday' ? `Time: ${l}` : `Date: ${l}`}
                contentStyle={{ background: 'var(--color-bg-surface)', border: '0.5px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}
              />
              <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={1.5} dot={chartPoints.length < 20} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            {activeRange.mode === 'intraday'
              ? `No cycle data in the last ${activeRange.hours === 1 ? '1 hour' : '24 hours'}`
              : 'Not enough data for this range'}
          </div>
        )}
      </div>

      {/* Daily P&L — only shown in daily mode */}
      {activeRange.mode === 'daily' && pnlBars.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 16 }}>daily P&L — {rangeLabel}</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={pnlBars}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} tickFormatter={(v) => `€${v}`} width={52} />
              <Tooltip
                formatter={(v: number) => [`€${v.toFixed(2)}`, 'P&L']}
                contentStyle={{ background: 'var(--color-bg-surface)', border: '0.5px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="pnl" isAnimationActive={false}>
                {pnlBars.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#16a34a' : '#dc2626'} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* AI cost breakdown */}
      {aiCost && aiCost.summary.callCount > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 16 }}>AI platform costs — claude-sonnet-4-6</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Total cost', value: `$${aiCost.summary.totalCostUsd.toFixed(4)}` },
              { label: 'Input tokens', value: fmtTokens(aiCost.summary.totalInputTokens), sub: `$${((aiCost.summary.totalInputTokens / 1_000_000) * 3).toFixed(4)}` },
              { label: 'Output tokens', value: fmtTokens(aiCost.summary.totalOutputTokens), sub: `$${((aiCost.summary.totalOutputTokens / 1_000_000) * 15).toFixed(4)}` },
              { label: 'Avg cost / call', value: `$${aiCost.summary.avgCostPerCallUsd.toFixed(5)}` },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ padding: '10px 12px', background: 'var(--color-bg-raised)', borderRadius: 4 }}>
                <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font-code)' }}>{value}</div>
                {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>}
              </div>
            ))}
          </div>

          {aiCost.byDay.length > 1 && (
            <>
              <div className="section-label" style={{ marginBottom: 10 }}>daily AI spend (30d)</div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={aiCost.byDay} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={(d) => d.slice(5)} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v: number) => [`$${v.toFixed(5)}`, 'AI cost']}
                    contentStyle={{ background: 'var(--color-bg-surface)', border: '0.5px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="costUsd" fill="var(--color-accent)" fillOpacity={0.55} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>
            Pricing: $3.00 / MTok input · $15.00 / MTok output (claude-sonnet-4-6, April 2026).
            Net P&L uses approximate USD → EUR conversion at 1.10.
          </div>
        </div>
      )}

      {/* Closed positions */}
      {positions?.closed && positions.closed.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <div className="section-label">closed positions ({positions.closed.length})</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Qty</th>
                <th style={{ textAlign: 'right' }}>Entry</th>
                <th style={{ textAlign: 'right' }}>Exit</th>
                <th style={{ textAlign: 'right' }}>Realized P&L</th>
                <th>Opened</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {positions.closed.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{p.ticker}</td>
                  <td>{p.quantity}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>{p.entryPrice != null ? `€${p.entryPrice.toFixed(2)}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>{p.exitPrice != null ? `€${p.exitPrice.toFixed(2)}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)', color: (p.realizedPnl ?? 0) >= 0 ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
                    {p.realizedPnl != null ? `${p.realizedPnl >= 0 ? '+' : ''}€${p.realizedPnl.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-code)' }}>
                    {new Date(p.openedAt).toLocaleDateString()}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-code)' }}>
                    {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary?.portfolioConfig && (
        <div style={{ display: 'flex', gap: 24, color: 'var(--color-text-muted)', fontSize: 12 }}>
          <span>Started: {new Date(summary.portfolioConfig.startedAt).toLocaleDateString()}</span>
          <span>Initial budget: €{summary.portfolioConfig.initialBudget.toFixed(2)}</span>
          <span>Total decisions: {summary.totalDecisions}</span>
        </div>
      )}
    </div>
  )
}
