import { useEffect, useState, useMemo } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  api,
  type Summary,
  type Performance,
  type DailySnapshot,
  type DailyStatsPoint,
  type AiPosition,
  type AiCostResponse,
} from '../api/client'
import StatCard from '../components/StatCard'

const CHART_HEIGHT = 160
const TOOLTIP_STYLE = {
  background: 'var(--color-bg-surface)',
  border: '0.5px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
}
const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-muted)' }
const GRID_STROKE = 'var(--color-border)'
const COLOR_GREEN = '#16a34a'
const COLOR_RED = '#dc2626'
const COLOR_ACCENT = '#2563eb'

type Range = '1W' | '1M' | '3M' | 'All'
const RANGE_DAYS: Record<Range, number | null> = { '1W': 7, '1M': 30, '3M': 90, All: null }

function sliceDays<T>(arr: T[], days: number | null): T[] {
  return days == null ? arr : arr.slice(-days)
}

function fmtEur(v: number | null | undefined) {
  return v == null ? '—' : `€${v.toFixed(2)}`
}

function fmtPct(v: number | null | undefined) {
  return v == null ? '—' : `${v.toFixed(1)}%`
}

function dateLabel(date: string) {
  return date.slice(5)
}

function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const options: Range[] = ['1W', '1M', '3M', 'All']
  return (
    <div
      style={{
        display: 'flex',
        border: '0.5px solid var(--color-border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {options.map((r, i) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          style={{
            height: 28,
            padding: '0 12px',
            border: 'none',
            borderRight: i < options.length - 1 ? '0.5px solid var(--color-border)' : 'none',
            background: value === r ? 'var(--color-bg-raised)' : 'transparent',
            color: value === r ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            fontSize: 12,
            fontWeight: value === r ? 500 : 400,
            cursor: 'pointer',
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <div className="section-label">{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Empty() {
  return (
    <div
      style={{
        height: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 12,
      }}
    >
      No data
    </div>
  )
}

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [performance, setPerformance] = useState<Performance | null>(null)
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStatsPoint[]>([])
  const [positions, setPositions] = useState<{ open: AiPosition[]; closed: AiPosition[] } | null>(
    null
  )
  const [aiCost, setAiCost] = useState<AiCostResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('1M')

  useEffect(() => {
    Promise.all([
      api.analytics.summary(),
      api.analytics.performance(),
      api.analytics.snapshots(365),
      api.analytics.dailyStats(365),
      api.analytics.positions(),
      api.analytics.aiCost(),
    ])
      .then(([s, p, snaps, stats, pos, ai]) => {
        setSummary(s)
        setPerformance(p)
        setSnapshots(snaps.data)
        setDailyStats(stats.data)
        setPositions(pos)
        setAiCost(ai)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const days = RANGE_DAYS[range]
  const closedPositions = useMemo(() => positions?.closed ?? [], [positions])

  const portfolioPoints = useMemo(
    () => sliceDays(snapshots, days).map((s) => ({ label: dateLabel(s.date), value: s.value })),
    [snapshots, days]
  )

  const dailyPnlPoints = useMemo(
    () =>
      sliceDays(dailyStats, days)
        .filter((s) => s.pnl != null)
        .map((s) => ({ label: dateLabel(s.date), pnl: s.pnl! })),
    [dailyStats, days]
  )

  const tradesPerDayPoints = useMemo(
    () =>
      sliceDays(dailyStats, days).map((s) => ({ label: dateLabel(s.date), trades: s.tradesCount })),
    [dailyStats, days]
  )

  const aiCostPoints = useMemo(
    () =>
      sliceDays(aiCost?.byDay ?? [], days).map((d) => ({
        label: dateLabel(d.date),
        cost: Number(d.costUsd.toFixed(5)),
      })),
    [aiCost, days]
  )

  const aiCallsPoints = useMemo(
    () =>
      sliceDays(aiCost?.byDay ?? [], days).map((d) => ({
        label: dateLabel(d.date),
        calls: d.calls,
      })),
    [aiCost, days]
  )

  const cumulativePnlPoints = useMemo(() => {
    const pnlByDate: Record<string, number> = {}
    for (const p of closedPositions) {
      if (!p.closedAt || p.realizedPnl == null) continue
      const date = p.closedAt.slice(0, 10)
      pnlByDate[date] = (pnlByDate[date] ?? 0) + p.realizedPnl
    }
    return Object.keys(pnlByDate)
      .sort()
      .reduce<{ label: string; cumPnl: number }[]>((acc, date) => {
        const prev = acc[acc.length - 1]?.cumPnl ?? 0
        acc.push({ label: dateLabel(date), cumPnl: Number((prev + pnlByDate[date]).toFixed(2)) })
        return acc
      }, [])
  }, [closedPositions])

  const tickerPnlBars = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const p of closedPositions) {
      acc[p.ticker] = Number(((acc[p.ticker] ?? 0) + (p.realizedPnl ?? 0)).toFixed(2))
    }
    return Object.entries(acc)
      .map(([ticker, pnl]) => ({ ticker, pnl }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [closedPositions])

  const holdTimeBars = useMemo(() => {
    const acc: Record<string, { totalHours: number; count: number }> = {}
    for (const p of closedPositions) {
      if (!p.closedAt) continue
      const hours = (new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime()) / 3_600_000
      if (!acc[p.ticker]) acc[p.ticker] = { totalHours: 0, count: 0 }
      acc[p.ticker].totalHours += hours
      acc[p.ticker].count += 1
    }
    return Object.entries(acc)
      .map(([ticker, { totalHours, count }]) => ({
        ticker,
        avgHours: Number((totalHours / count).toFixed(1)),
      }))
      .sort((a, b) => b.avgHours - a.avgHours)
  }, [closedPositions])

  const winLossData = useMemo(() => {
    if (!performance || performance.wins + performance.losses === 0) return []
    return [
      { name: 'Wins', value: performance.wins },
      { name: 'Losses', value: performance.losses },
    ].filter((d) => d.value > 0)
  }, [performance])

  const totalAiCostUsd = aiCost?.summary.totalCostUsd ?? 0
  const aiCostEur = totalAiCostUsd / 1.1
  const totalPnl = summary?.realizedPnl ?? null
  const netPnl = totalPnl != null ? totalPnl - aiCostEur : null
  const lastCumPnl = cumulativePnlPoints[cumulativePnlPoints.length - 1]?.cumPnl ?? 0

  if (loading)
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Analytics</h1>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Realized P&L"
          value={fmtEur(totalPnl)}
          sub="gross trade P&L"
          positive={(totalPnl ?? 0) > 0}
          negative={(totalPnl ?? 0) < 0}
        />
        <StatCard
          label="Net P&L"
          value={fmtEur(netPnl)}
          sub="after AI costs"
          positive={(netPnl ?? 0) > 0}
          negative={(netPnl ?? 0) < 0}
        />
        <StatCard
          label="Win rate"
          value={fmtPct(performance?.winRate)}
          sub={`${performance?.wins ?? 0}W · ${performance?.losses ?? 0}L`}
        />
        <StatCard
          label="Total trades"
          value={summary?.totalTrades ?? '—'}
          sub={`${summary?.daysTraded ?? 0} days traded`}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <ChartCard title="portfolio value">
          {portfolioPoints.length > 1 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={portfolioPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `€${v}`}
                  width={52}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'Value']}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLOR_ACCENT}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="daily P&L">
          {dailyPnlPoints.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={dailyPnlPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `€${v}`}
                  width={52}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'P&L']}
                />
                <Bar dataKey="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                  {dailyPnlPoints.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.pnl >= 0 ? COLOR_GREEN : COLOR_RED}
                      fillOpacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="cumulative P&L" sub="all-time">
          {cumulativePnlPoints.length > 1 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={cumulativePnlPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `€${v}`}
                  width={52}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'Cumulative P&L']}
                />
                <Line
                  type="monotone"
                  dataKey="cumPnl"
                  stroke={lastCumPnl >= 0 ? COLOR_GREEN : COLOR_RED}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="trades per day">
          {tradesPerDayPoints.some((p) => p.trades > 0) ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={tradesPerDayPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Trades']} />
                <Bar
                  dataKey="trades"
                  fill={COLOR_ACCENT}
                  fillOpacity={0.65}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="win / loss" sub="all-time">
          {winLossData.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={winLossData}
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={62}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  <Cell fill={COLOR_GREEN} fillOpacity={0.8} />
                  <Cell fill={COLOR_RED} fillOpacity={0.7} />
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [v, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="P&L by ticker" sub="all-time">
          {tickerPnlBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={tickerPnlBars} layout="vertical">
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `€${v}`}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  tick={{ ...AXIS_TICK, fontFamily: 'var(--font-code)' }}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'P&L']}
                />
                <Bar dataKey="pnl" isAnimationActive={false} radius={[0, 2, 2, 0]}>
                  {tickerPnlBars.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.pnl >= 0 ? COLOR_GREEN : COLOR_RED}
                      fillOpacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="AI cost per day">
          {aiCostPoints.some((p) => p.cost > 0) ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={aiCostPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(3)}`}
                  width={56}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`$${v.toFixed(5)}`, 'Cost']}
                />
                <Bar
                  dataKey="cost"
                  fill={COLOR_ACCENT}
                  fillOpacity={0.65}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="AI calls per day">
          {aiCallsPoints.some((p) => p.calls > 0) ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={aiCallsPoints}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Calls']} />
                <Bar
                  dataKey="calls"
                  fill={COLOR_ACCENT}
                  fillOpacity={0.45}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title="avg hold time" sub="hours · all-time">
          {holdTimeBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={holdTimeBars} layout="vertical">
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}h`}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  tick={{ ...AXIS_TICK, fontFamily: 'var(--font-code)' }}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`${v}h`, 'Avg hold']}
                />
                <Bar
                  dataKey="avgHours"
                  fill={COLOR_ACCENT}
                  fillOpacity={0.45}
                  isAnimationActive={false}
                  radius={[0, 2, 2, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>
      </div>

      {aiCost && aiCost.summary.callCount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          AI cost: ${totalAiCostUsd.toFixed(4)} total · {aiCost.summary.callCount} calls · avg $
          {aiCost.summary.avgCostPerCallUsd.toFixed(5)}/call · claude-sonnet-4-6 · $3/MTok in ·
          $15/MTok out
        </div>
      )}

      {closedPositions.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <div className="section-label">closed positions ({closedPositions.length})</div>
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
              {closedPositions.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{p.ticker}</td>
                  <td>{p.quantity}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                    {p.entryPrice != null ? `€${p.entryPrice.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-code)' }}>
                    {p.exitPrice != null ? `€${p.exitPrice.toFixed(2)}` : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-code)',
                      color: (p.realizedPnl ?? 0) >= 0 ? COLOR_GREEN : COLOR_RED,
                      fontWeight: 500,
                    }}
                  >
                    {p.realizedPnl != null
                      ? `${p.realizedPnl >= 0 ? '+' : ''}€${p.realizedPnl.toFixed(2)}`
                      : '—'}
                  </td>
                  <td
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-code)',
                    }}
                  >
                    {new Date(p.openedAt).toLocaleDateString()}
                  </td>
                  <td
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-code)',
                    }}
                  >
                    {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
