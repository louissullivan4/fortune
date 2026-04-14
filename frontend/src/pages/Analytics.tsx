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

type Range = 'Today' | '1W' | '1M' | '3M' | 'All'
const RANGE_DAYS: Record<Range, number | null> = { Today: 1, '1W': 7, '1M': 30, '3M': 90, All: null }
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  return date.slice(5, 10)
}

function fmtUsdAxis(v: number): string {
  if (v === 0) return '$0'
  if (v < 0.001) return `$${v.toFixed(5)}`
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${parseFloat(v.toFixed(3))}`
}

function fmtEurAxis(v: number): string {
  if (v === 0) return '€0'
  if (Math.abs(v) >= 1000) return `€${(v / 1000).toFixed(1)}k`
  return `€${parseFloat(v.toFixed(2))}`
}

function RangeSelector({
  value,
  onChange,
  pickedDate,
  onPickDate,
}: {
  value: Range
  onChange: (r: Range) => void
  pickedDate: string | null
  onPickDate: (d: string | null) => void
}) {
  const options: Range[] = ['Today', '1W', '1M', '3M', 'All']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            onClick={() => { onChange(r); onPickDate(null) }}
            style={{
              height: 28,
              padding: '0 12px',
              border: 'none',
              borderRight: i < options.length - 1 ? '0.5px solid var(--color-border)' : 'none',
              background: value === r && pickedDate === null ? 'var(--color-bg-raised)' : 'transparent',
              color: value === r && pickedDate === null ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: 12,
              fontWeight: value === r && pickedDate === null ? 500 : 400,
              cursor: 'pointer',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            {r}
          </button>
      ))}
      </div>
      <input
        type="date"
        value={pickedDate ?? ''}
        max={localDateStr(new Date())}
        onChange={(e) => onPickDate(e.target.value || null)}
        style={{
          height: 28,
          padding: '0 8px',
          border: `0.5px solid ${pickedDate ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 4,
          background: 'var(--color-bg-surface)',
          color: pickedDate ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          fontSize: 12,
          cursor: 'pointer',
          outline: 'none',
        }}
      />
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

const PAGE_SIZE = 10

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [posPage, setPosPage] = useState(1)
  const [performance, setPerformance] = useState<Performance | null>(null)
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStatsPoint[]>([])
  const [positions, setPositions] = useState<{ open: AiPosition[]; closed: AiPosition[] } | null>(
    null
  )
  const [aiCost, setAiCost] = useState<AiCostResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('Today')
  const [pickedDate, setPickedDate] = useState<string | null>(null)

  function handleRangeChange(r: Range) { setRange(r); setPosPage(1) }
  function handlePickDate(d: string | null) { setPickedDate(d); setPosPage(1) }

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

  const closedPositions = useMemo(() => positions?.closed ?? [], [positions])
  const isHourlyMode = range === 'Today' || pickedDate !== null

  const rangeCutoff: number | null = (() => {
    if (pickedDate !== null) return null
    switch (range) {
      case 'Today': return Date.now() - 24 * 3600 * 1000
      case '1W': return Date.now() - 7 * 24 * 3600 * 1000
      case '1M': return Date.now() - 30 * 24 * 3600 * 1000
      case '3M': return Date.now() - 90 * 24 * 3600 * 1000
      case 'All': return null
    }
  })()

  function inWindow(dateStr: string): boolean {
    const d = new Date(dateStr)
    if (pickedDate !== null) return localDateStr(d) === pickedDate
    return rangeCutoff === null || d.getTime() >= rangeCutoff
  }

  function inWindowDate(dateStr: string): boolean {
    const d = new Date(dateStr)
    if (pickedDate !== null) return localDateStr(d) === pickedDate
    if (rangeCutoff === null) return true
    const endOfDay = d.getTime() + 24 * 3600 * 1000
    return endOfDay > rangeCutoff
  }

  function hKey(isoDate: string): string {
    const d = new Date(isoDate)
    return `${localDateStr(d)}T${String(d.getHours()).padStart(2, '0')}`
  }

  function hLabel(key: string): string {
    return `${key.slice(11)}:00`
  }

  const periodLabel = pickedDate
    ? new Date(`${pickedDate}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : range === 'All' ? 'all-time' : range === 'Today' ? 'last 24h' : range

  const filteredClosedPositions = useMemo(
    () => closedPositions.filter((p) => p.closedAt && inWindow(p.closedAt)),
    [closedPositions, pickedDate, range]
  )

  const filteredAiDays = useMemo(
    () => (aiCost?.byDay ?? []).filter((d) => inWindowDate(d.date)),
    [aiCost, pickedDate, range]
  )

  const filteredStats = useMemo(() => {
    const wins = filteredClosedPositions.filter((p) => (p.realizedPnl ?? 0) > 0)
    const losses = filteredClosedPositions.filter((p) => (p.realizedPnl ?? 0) < 0)
    const decided = wins.length + losses.length
    const daysTraded = new Set(
      filteredClosedPositions.map((p) => p.closedAt?.slice(0, 10)).filter(Boolean)
    ).size
    return {
      realizedPnl: filteredClosedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0),
      wins: wins.length,
      losses: losses.length,
      winRate: decided > 0 ? (wins.length / decided) * 100 : null,
      totalTrades: filteredClosedPositions.length,
      daysTraded,
    }
  }, [filteredClosedPositions])

  const filteredAiCostUsd = useMemo(
    () => filteredAiDays.reduce((s, d) => s + d.costUsd, 0),
    [filteredAiDays]
  )

  const filteredAiCalls = useMemo(
    () => filteredAiDays.reduce((s, d) => s + d.calls, 0),
    [filteredAiDays]
  )

  const hourlyPnlPoints = useMemo(() => {
    if (!isHourlyMode) return []
    const byHour: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt || p.realizedPnl == null) continue
      const k = hKey(p.closedAt)
      byHour[k] = (byHour[k] ?? 0) + p.realizedPnl
    }
    return Object.keys(byHour).sort().map((k) => ({ label: hLabel(k), pnl: Number(byHour[k].toFixed(2)) }))
  }, [filteredClosedPositions, isHourlyMode])

  const hourlyTradesPoints = useMemo(() => {
    if (!isHourlyMode) return []
    const byHour: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt) continue
      const k = hKey(p.closedAt)
      byHour[k] = (byHour[k] ?? 0) + 1
    }
    return Object.keys(byHour).sort().map((k) => ({ label: hLabel(k), trades: byHour[k] }))
  }, [filteredClosedPositions, isHourlyMode])

  const hourlyCumPnlPoints = useMemo(() => {
    if (!isHourlyMode) return []
    const byHour: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt || p.realizedPnl == null) continue
      const k = hKey(p.closedAt)
      byHour[k] = (byHour[k] ?? 0) + p.realizedPnl
    }
    let cum = 0
    return Object.keys(byHour).sort().map((k) => {
      cum += byHour[k]
      return { label: hLabel(k), cumPnl: Number(cum.toFixed(2)) }
    })
  }, [filteredClosedPositions, isHourlyMode])

  const portfolioPoints = useMemo(
    () => snapshots.filter((s) => inWindowDate(s.date)).map((s) => ({ label: dateLabel(s.date), value: s.value })),
    [snapshots, pickedDate, range]
  )

  const dailyPnlPoints = useMemo(() => {
    if (isHourlyMode) return []
    const byDate: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt || p.realizedPnl == null) continue
      const date = p.closedAt.slice(0, 10)
      byDate[date] = (byDate[date] ?? 0) + p.realizedPnl
    }
    return Object.keys(byDate).sort().map((date) => ({ label: dateLabel(date), pnl: Number(byDate[date].toFixed(2)) }))
  }, [filteredClosedPositions, isHourlyMode])

  const tradesPerDayPoints = useMemo(() => {
    if (isHourlyMode) return []
    const byDate: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt) continue
      const date = p.closedAt.slice(0, 10)
      byDate[date] = (byDate[date] ?? 0) + 1
    }
    return Object.keys(byDate).sort().map((date) => ({ label: dateLabel(date), trades: byDate[date] }))
  }, [filteredClosedPositions, isHourlyMode])

  const aiCostPoints = useMemo(
    () => filteredAiDays.map((d) => ({ label: dateLabel(d.date), cost: Number(d.costUsd.toFixed(5)) })),
    [filteredAiDays]
  )

  const aiCallsPoints = useMemo(
    () => filteredAiDays.map((d) => ({ label: dateLabel(d.date), calls: d.calls })),
    [filteredAiDays]
  )

  const cumulativePnlPoints = useMemo(() => {
    const pnlByDate: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
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
  }, [filteredClosedPositions])

  const tickerPnlBars = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const p of filteredClosedPositions) {
      acc[p.ticker] = Number(((acc[p.ticker] ?? 0) + (p.realizedPnl ?? 0)).toFixed(2))
    }
    return Object.entries(acc).map(([ticker, pnl]) => ({ ticker, pnl })).sort((a, b) => b.pnl - a.pnl)
  }, [filteredClosedPositions])

  const holdTimeBars = useMemo(() => {
    const acc: Record<string, { totalHours: number; count: number }> = {}
    for (const p of filteredClosedPositions) {
      if (!p.closedAt) continue
      const hours = (new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime()) / 3_600_000
      if (!acc[p.ticker]) acc[p.ticker] = { totalHours: 0, count: 0 }
      acc[p.ticker].totalHours += hours
      acc[p.ticker].count += 1
    }
    return Object.entries(acc)
      .map(([ticker, { totalHours, count }]) => ({ ticker, avgHours: Number((totalHours / count).toFixed(1)) }))
      .sort((a, b) => b.avgHours - a.avgHours)
  }, [filteredClosedPositions])

  const winLossData = useMemo(() => {
    if (filteredStats.wins + filteredStats.losses === 0) return []
    return [
      { name: 'Wins', value: filteredStats.wins },
      { name: 'Losses', value: filteredStats.losses },
    ].filter((d) => d.value > 0)
  }, [filteredStats])

  const filteredAiCostEur = filteredAiCostUsd / 1.1
  const filteredNetPnl = filteredStats.realizedPnl - filteredAiCostEur
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
        <RangeSelector value={range} onChange={handleRangeChange} pickedDate={pickedDate} onPickDate={handlePickDate} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Realized P&L"
          value={fmtEur(filteredStats.realizedPnl)}
          sub={periodLabel}
          positive={filteredStats.realizedPnl > 0}
          negative={filteredStats.realizedPnl < 0}
        />
        <StatCard
          label="AI cost"
          value={fmtEur(filteredAiCostEur)}
          sub={`${filteredAiCalls} calls`}
        />
        <StatCard
          label="Net P&L"
          value={fmtEur(filteredNetPnl)}
          sub={periodLabel}
          positive={filteredNetPnl > 0}
          negative={filteredNetPnl < 0}
        />
        <StatCard
          label="Win rate"
          value={fmtPct(filteredStats.winRate)}
          sub={`${filteredStats.wins}W · ${filteredStats.losses}L`}
        />
        <StatCard
          label="Total trades"
          value={filteredStats.totalTrades}
          sub={`${filteredStats.daysTraded} days`}
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
          {isHourlyMode ? (
            <div
              style={{
                height: CHART_HEIGHT,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 500 }}>
                {portfolioPoints[portfolioPoints.length - 1]?.value != null
                  ? `€${portfolioPoints[portfolioPoints.length - 1].value.toFixed(2)}`
                  : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>latest snapshot</div>
            </div>
          ) : portfolioPoints.length >= 1 ? (
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
                  tickFormatter={fmtEurAxis}
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
                  dot={portfolioPoints.length === 1 ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title={isHourlyMode ? 'P&L by hour' : 'daily P&L'}>
          {(isHourlyMode ? hourlyPnlPoints : dailyPnlPoints).length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={isHourlyMode ? hourlyPnlPoints : dailyPnlPoints}>
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
                  tickFormatter={fmtEurAxis}
                  width={52}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [`€${v.toFixed(2)}`, 'P&L']}
                />
                <Bar dataKey="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                  {(isHourlyMode ? hourlyPnlPoints : dailyPnlPoints).map((entry, i) => (
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

        <ChartCard title="cumulative P&L" sub={periodLabel}>
          {(isHourlyMode ? hourlyCumPnlPoints : cumulativePnlPoints).length >= 1 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={isHourlyMode ? hourlyCumPnlPoints : cumulativePnlPoints}>
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
                  tickFormatter={fmtEurAxis}
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
                  dot={(isHourlyMode ? hourlyCumPnlPoints : cumulativePnlPoints).length === 1 ? { r: 3 } : false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </ChartCard>

        <ChartCard title={isHourlyMode ? 'trades by hour' : 'trades per day'}>
          {(isHourlyMode ? hourlyTradesPoints : tradesPerDayPoints).some((p) => p.trades > 0) ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={isHourlyMode ? hourlyTradesPoints : tradesPerDayPoints}>
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

        <ChartCard title="win / loss" sub={periodLabel}>
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

        <ChartCard title="P&L by ticker" sub={periodLabel}>
          {tickerPnlBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={tickerPnlBars} layout="vertical">
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtEurAxis}
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
                  tickFormatter={fmtUsdAxis}
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

        <ChartCard title="avg hold time" sub={`hours · ${periodLabel}`}>
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

      {filteredAiCalls > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          AI cost: ${filteredAiCostUsd.toFixed(4)} total · {filteredAiCalls} calls · avg $
          {filteredAiCalls > 0 ? (filteredAiCostUsd / filteredAiCalls).toFixed(5) : '0.00000'}/call ·
          claude-sonnet-4-6 · $3/MTok in · $15/MTok out
        </div>
      )}

      {filteredClosedPositions.length > 0 && (() => {
        const totalPages = Math.ceil(filteredClosedPositions.length / PAGE_SIZE)
        const page = Math.min(posPage, totalPages)
        const pageRows = filteredClosedPositions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '16px 16px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div className="section-label">closed positions ({filteredClosedPositions.length})</div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ height: 24, padding: '0 8px', fontSize: 12 }}
                    disabled={page <= 1}
                    onClick={() => setPosPage((p) => p - 1)}
                  >
                    ←
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ height: 24, padding: '0 8px', fontSize: 12 }}
                    disabled={page >= totalPages}
                    onClick={() => setPosPage((p) => p + 1)}
                  >
                    →
                  </button>
                </div>
              )}
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
                {pageRows.map((p) => (
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
        )
      })()}
    </div>
  )
}
