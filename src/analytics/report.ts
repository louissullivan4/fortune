import ExcelJS from 'exceljs'
import { getPool } from '../db.js'

const MAX_REPORT_DAYS = 366

export interface ReportParams {
  userId: string
  from: string
  to: string
}

export interface ReportValidationError {
  error: string
}

export function validateReportRange(from: string, to: string): ReportValidationError | null {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { error: 'Invalid date format. Use YYYY-MM-DD.' }
  }
  if (fromDate > toDate) {
    return { error: 'from date must be before or equal to to date.' }
  }
  const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
  if (diffDays > MAX_REPORT_DAYS) {
    return { error: `Date range must not exceed ${MAX_REPORT_DAYS} days (requested ${diffDays}).` }
  }
  return null
}

interface ReportPosition {
  id: number
  ticker: string
  opened_at: string
  closed_at: string | null
  entry_price: number | null
  exit_price: number | null
  quantity: number
  realized_pnl: number | null
  high_water_mark: number | null
  status: string
  open_reasoning: string | null
  close_reasoning: string | null
}

interface ReportDecision {
  id: number
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  estimated_price: number | null
  reasoning: string
  signals_json: string | null
  order_status: string | null
  fill_price: number | null
  total_cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
  model: string | null
}

interface ReportAiUsage {
  id: number
  timestamp: string
  model: string | null
  decision_id: number | null
  total_cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
}

async function loadReportPositions(
  userId: string,
  from: string,
  to: string
): Promise<ReportPosition[]> {
  const pool = getPool()
  const res = await pool.query<ReportPosition>(
    `SELECT
       p.id, p.ticker, p.opened_at, p.closed_at,
       p.entry_price, p.exit_price, p.quantity,
       p.realized_pnl, p.high_water_mark, p.status,
       d_open.reasoning  AS open_reasoning,
       d_close.reasoning AS close_reasoning
     FROM ai_positions p
     LEFT JOIN decisions d_open
       ON d_open.ticker  = p.ticker
      AND d_open.action  = 'buy'
      AND d_open.timestamp = p.opened_at
      AND d_open.user_id = p.user_id
     LEFT JOIN decisions d_close
       ON d_close.ticker  = p.ticker
      AND d_close.action  = 'sell'
      AND d_close.timestamp = p.closed_at
      AND d_close.user_id = p.user_id
     WHERE p.user_id = $1
       AND (p.opened_at::date BETWEEN $2 AND $3
            OR p.closed_at::date BETWEEN $2 AND $3)
     ORDER BY p.opened_at DESC`,
    [userId, from, to]
  )
  return res.rows.map((r) => ({
    ...r,
    entry_price: r.entry_price != null ? Number(r.entry_price) : null,
    exit_price: r.exit_price != null ? Number(r.exit_price) : null,
    quantity: Number(r.quantity),
    realized_pnl: r.realized_pnl != null ? Number(r.realized_pnl) : null,
    high_water_mark: r.high_water_mark != null ? Number(r.high_water_mark) : null,
  }))
}

async function loadReportDecisions(
  userId: string,
  from: string,
  to: string
): Promise<ReportDecision[]> {
  const pool = getPool()
  const res = await pool.query<ReportDecision>(
    `SELECT
       d.id, d.timestamp, d.action, d.ticker, d.quantity,
       d.estimated_price, d.reasoning, d.signals_json,
       o.status AS order_status, o.fill_price,
       au.total_cost_usd, au.input_tokens, au.output_tokens, au.model
     FROM decisions d
     LEFT JOIN orders  o  ON o.decision_id  = d.id
     LEFT JOIN ai_usage au ON au.decision_id = d.id
     WHERE d.user_id = $1
       AND d.timestamp::date BETWEEN $2 AND $3
     ORDER BY d.timestamp ASC`,
    [userId, from, to]
  )
  return res.rows.map((r) => ({
    ...r,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    estimated_price: r.estimated_price != null ? Number(r.estimated_price) : null,
    fill_price: r.fill_price != null ? Number(r.fill_price) : null,
    total_cost_usd: r.total_cost_usd != null ? Number(r.total_cost_usd) : null,
    input_tokens: r.input_tokens != null ? Number(r.input_tokens) : null,
    output_tokens: r.output_tokens != null ? Number(r.output_tokens) : null,
  }))
}

async function loadReportAiUsage(
  userId: string,
  from: string,
  to: string
): Promise<ReportAiUsage[]> {
  const pool = getPool()
  const res = await pool.query<ReportAiUsage>(
    `SELECT id, timestamp, model, decision_id, total_cost_usd, input_tokens, output_tokens
     FROM ai_usage
     WHERE user_id = $1
       AND timestamp::date BETWEEN $2 AND $3
     ORDER BY timestamp ASC`,
    [userId, from, to]
  )
  return res.rows.map((r) => ({
    ...r,
    total_cost_usd: r.total_cost_usd != null ? Number(r.total_cost_usd) : null,
    input_tokens: r.input_tokens != null ? Number(r.input_tokens) : null,
    output_tokens: r.output_tokens != null ? Number(r.output_tokens) : null,
  }))
}

const BG_HEADER = 'FF1A1A18'
const BG_SECTION = 'FFF5F5F4'
const TEXT_MUTED = 'FF6B6B67'
const COLOR_WIN = 'FF16A34A'
const COLOR_LOSS = 'FFDC2626'
const FONT_UI = 'Calibri'

function headerStyle(ws: ExcelJS.Worksheet, row: number, cols: string[]) {
  for (let i = 0; i < cols.length; i++) {
    const cell = ws.getCell(row, i + 1)
    cell.value = cols[i]
    cell.font = { name: FONT_UI, bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_HEADER } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D2' } } }
  }
  ws.getRow(row).height = 22
}

function sectionTitle(ws: ExcelJS.Worksheet, row: number, title: string, span: number) {
  const cell = ws.getCell(row, 1)
  cell.value = title.toUpperCase()
  cell.font = { name: FONT_UI, bold: true, size: 9, color: { argb: TEXT_MUTED } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BG_SECTION } }
  ws.mergeCells(row, 1, row, span)
  ws.getRow(row).height = 18
}

function kv(ws: ExcelJS.Worksheet, row: number, label: string, value: string | number | null) {
  const lc = ws.getCell(row, 1)
  lc.value = label
  lc.font = { name: FONT_UI, size: 10, color: { argb: TEXT_MUTED } }
  lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }

  const vc = ws.getCell(row, 2)
  vc.value = value ?? '—'
  vc.font = { name: FONT_UI, bold: true, size: 10 }
  vc.alignment = { horizontal: 'right' }
  vc.border = { bottom: { style: 'thin', color: { argb: 'FFD4D4D2' } } }
  ws.getRow(row).height = 18
}

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  try {
    return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 60000) * 10) / 10
  } catch {
    return null
  }
}

function inferExitType(reasoning: string | null): string {
  const r = (reasoning ?? '').toLowerCase()
  if (r.includes('stagnant')) return 'stagnant'
  if (r.includes('take-profit') || r.includes('take profit')) return 'take_profit'
  if (r.includes('stop-loss') || r.includes('stop loss')) return 'stop_loss'
  if (r.includes('trailing')) return 'trailing_stop'
  return 'ai_sell'
}

function pct(value: number | null, decimals = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(decimals)}%`
}

function eur(value: number | null, decimals = 4): string | number {
  if (value == null) return '—'
  return Number(value.toFixed(decimals))
}

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  positions: ReportPosition[],
  decisions: ReportDecision[],
  aiUsage: ReportAiUsage[],
  from: string,
  to: string,
  userLabel: string
) {
  const ws = wb.addWorksheet('Summary')
  ws.views = [{ showGridLines: false }]
  ws.getColumn(1).width = 32
  ws.getColumn(2).width = 22

  const closed = positions.filter((p) => p.status === 'closed' && p.exit_price != null)
  const wins = closed.filter((p) => (p.realized_pnl ?? 0) > 0)
  const losses = closed.filter((p) => (p.realized_pnl ?? 0) <= 0)
  const totalPnl = closed.reduce((s, p) => s + (p.realized_pnl ?? 0), 0)
  const buys = decisions.filter((d) => d.action === 'buy')
  const sells = decisions.filter((d) => d.action === 'sell')
  const holds = decisions.filter((d) => d.action === 'hold')
  const totalAiCost = aiUsage.reduce((s, u) => s + (u.total_cost_usd ?? 0), 0)

  const holdMins = closed
    .map((p) => minutesBetween(p.opened_at, p.closed_at))
    .filter((h): h is number => h != null)
  const avgHold = holdMins.length ? holdMins.reduce((s, h) => s + h, 0) / holdMins.length : null

  const stagnantExits = closed.filter((p) =>
    (p.close_reasoning ?? '').toLowerCase().includes('stagnant')
  ).length
  const tpExits = closed.filter((p) => {
    const r = (p.close_reasoning ?? '').toLowerCase()
    return r.includes('take-profit') || r.includes('take profit')
  }).length
  const slExits = closed.filter((p) => {
    const r = (p.close_reasoning ?? '').toLowerCase()
    return r.includes('stop-loss') || r.includes('stop loss')
  }).length

  const title = ws.getCell(1, 1)
  title.value = `Algorithm Performance Report — ${userLabel} — ${from} to ${to}`
  title.font = { name: FONT_UI, bold: true, size: 14 }
  ws.mergeCells(1, 1, 1, 2)
  ws.getRow(1).height = 28

  const gen = ws.getCell(2, 1)
  gen.value = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
  gen.font = { name: FONT_UI, size: 10, color: { argb: TEXT_MUTED } }
  ws.mergeCells(2, 1, 2, 2)

  let r = 4
  const sections: Array<[string, Array<[string, string | number | null]>]> = [
    [
      'Overall Performance',
      [
        ['Total closed trades', closed.length],
        ['Winning trades', wins.length],
        ['Losing trades', losses.length],
        ['Win rate', closed.length ? pct((wins.length / closed.length) * 100) : '—'],
        ['Total realised P&L (€)', eur(totalPnl)],
        ['Avg P&L per trade (€)', closed.length ? eur(totalPnl / closed.length) : '—'],
      ],
    ],
    [
      'Trade Timing',
      [
        ['Avg hold duration (min)', avgHold != null ? Math.round(avgHold * 10) / 10 : '—'],
        ['Shortest hold (min)', holdMins.length ? Math.min(...holdMins) : '—'],
        ['Longest hold (min)', holdMins.length ? Math.max(...holdMins) : '—'],
      ],
    ],
    [
      'Exit Breakdown',
      [
        ['Stagnant exits', stagnantExits],
        ['Take-profit exits', tpExits],
        ['Stop-loss exits', slExits],
        ['AI-driven sells', sells.length - stagnantExits - tpExits - slExits],
      ],
    ],
    [
      'AI Decision Activity',
      [
        ['Total AI calls', decisions.length],
        ['Buy decisions', buys.length],
        ['Sell decisions', sells.length],
        ['Hold decisions', holds.length],
        ['Buy rate', decisions.length ? pct((buys.length / decisions.length) * 100) : '—'],
      ],
    ],
    [
      'AI Cost',
      [
        ['Total AI cost (USD)', Number(totalAiCost.toFixed(5))],
        [
          'Avg cost per call (USD)',
          aiUsage.length ? Number((totalAiCost / aiUsage.length).toFixed(5)) : '—',
        ],
        ['Total tokens (input)', aiUsage.reduce((s, u) => s + (u.input_tokens ?? 0), 0)],
        ['Total tokens (output)', aiUsage.reduce((s, u) => s + (u.output_tokens ?? 0), 0)],
        ['Cost vs P&L ratio', totalPnl ? pct((totalAiCost / totalPnl) * 100) : '—'],
      ],
    ],
  ]

  for (const [title2, rows] of sections) {
    sectionTitle(ws, r, title2, 2)
    r++
    for (const [label, value] of rows) {
      kv(ws, r, label, value)
      r++
    }
    r++
  }
}

function buildTradeLogSheet(wb: ExcelJS.Workbook, positions: ReportPosition[]) {
  const ws = wb.addWorksheet('Trade Log')
  ws.views = [{ showGridLines: false }]

  const cols = [
    'ID',
    'Ticker',
    'Status',
    'Opened At',
    'Closed At',
    'Entry €',
    'Exit €',
    'Qty',
    'Realised P&L €',
    'P&L %',
    'Hold (min)',
    'High Water €',
    'MDD %',
    'Exit Type',
  ]
  const widths = [6, 14, 10, 22, 22, 10, 10, 8, 14, 10, 12, 14, 10, 14]
  headerStyle(ws, 1, cols)
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const row = i + 2
    const entry = p.entry_price ?? 0
    const exit = p.exit_price
    const pnl = p.realized_pnl
    const pnlPct = entry && exit ? Number((((exit - entry) / entry) * 100).toFixed(3)) : null
    const holdMin = minutesBetween(p.opened_at, p.closed_at)
    const hwm = p.high_water_mark
    const mddPct = hwm && hwm > 0 && exit ? Number((((hwm - exit) / hwm) * 100).toFixed(3)) : null

    const vals = [
      p.id,
      p.ticker,
      p.status,
      p.opened_at,
      p.closed_at ?? '',
      entry ? Number(entry.toFixed(4)) : null,
      exit ? Number(exit.toFixed(4)) : null,
      p.quantity,
      pnl != null ? Number(pnl.toFixed(4)) : null,
      pnlPct,
      holdMin,
      hwm ? Number(hwm.toFixed(4)) : null,
      mddPct,
      inferExitType(p.close_reasoning),
    ]

    vals.forEach((val, col) => {
      const cell = ws.getCell(row, col + 1)
      cell.value = val
      cell.font = { name: FONT_UI, size: 10 }
      cell.alignment = { horizontal: col <= 1 ? 'center' : 'right' }

      if (p.status === 'open') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }
      }
      if (col === 8 && pnl != null) {
        cell.font = {
          name: FONT_UI,
          size: 10,
          color: { argb: pnl > 0 ? COLOR_WIN : COLOR_LOSS },
        }
      }
    })
    ws.getRow(row).height = 16
  }
}

function buildTickerBreakdownSheet(wb: ExcelJS.Workbook, positions: ReportPosition[]) {
  const ws = wb.addWorksheet('Ticker Breakdown')
  ws.views = [{ showGridLines: false }]

  const closed = positions.filter((p) => p.status === 'closed' && p.exit_price != null)
  const byTicker: Record<string, ReportPosition[]> = {}
  for (const p of closed) {
    if (!byTicker[p.ticker]) byTicker[p.ticker] = []
    byTicker[p.ticker].push(p)
  }

  const cols = [
    'Ticker',
    'Trades',
    'Wins',
    'Losses',
    'Win Rate %',
    'Total P&L €',
    'Avg P&L €',
    'Avg P&L %',
    'Avg Hold (min)',
    'Best Trade €',
    'Worst Trade €',
    'Stagnant Exits',
  ]
  const widths = [14, 9, 8, 9, 12, 14, 12, 12, 15, 14, 14, 16]
  headerStyle(ws, 1, cols)
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const rows = Object.entries(byTicker).map(([ticker, trades]) => {
    const pnls = trades.map((p) => p.realized_pnl ?? 0)
    const pctGains = trades
      .filter((p) => p.entry_price && p.exit_price)
      .map((p) => ((p.exit_price! - p.entry_price!) / p.entry_price!) * 100)
    const holds = trades
      .map((p) => minutesBetween(p.opened_at, p.closed_at))
      .filter((h): h is number => h != null)
    const winCount = pnls.filter((v) => v > 0).length
    return {
      ticker,
      trades: trades.length,
      wins: winCount,
      losses: trades.length - winCount,
      winRate: Number(((winCount / trades.length) * 100).toFixed(1)),
      totalPnl: Number(pnls.reduce((s, v) => s + v, 0).toFixed(4)),
      avgPnl: Number((pnls.reduce((s, v) => s + v, 0) / pnls.length).toFixed(4)),
      avgPct: pctGains.length
        ? Number((pctGains.reduce((s, v) => s + v, 0) / pctGains.length).toFixed(3))
        : null,
      avgHold: holds.length
        ? Number((holds.reduce((s, h) => s + h, 0) / holds.length).toFixed(1))
        : null,
      best: Number(Math.max(...pnls).toFixed(4)),
      worst: Number(Math.min(...pnls).toFixed(4)),
      stagnant: trades.filter((p) => (p.close_reasoning ?? '').toLowerCase().includes('stagnant'))
        .length,
    }
  })

  rows.sort((a, b) => b.totalPnl - a.totalPnl)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const row = i + 2
    const vals = [
      r.ticker,
      r.trades,
      r.wins,
      r.losses,
      r.winRate,
      r.totalPnl,
      r.avgPnl,
      r.avgPct,
      r.avgHold,
      r.best,
      r.worst,
      r.stagnant,
    ]
    vals.forEach((val, col) => {
      const cell = ws.getCell(row, col + 1)
      cell.value = val
      cell.font = { name: FONT_UI, size: 10 }
      cell.alignment = { horizontal: col === 0 ? 'left' : 'right' }

      if (col === 4) {
        cell.font = {
          name: FONT_UI,
          size: 10,
          color: {
            argb: r.winRate >= 70 ? COLOR_WIN : r.winRate < 50 ? COLOR_LOSS : 'FF1A1A18',
          },
        }
      }
      if (col === 5) {
        cell.font = {
          name: FONT_UI,
          size: 10,
          color: { argb: r.totalPnl > 0 ? COLOR_WIN : COLOR_LOSS },
        }
      }
    })
    ws.getRow(row).height = 16
  }
}

function buildExitAnalysisSheet(wb: ExcelJS.Workbook, positions: ReportPosition[]) {
  const ws = wb.addWorksheet('Exit Analysis')
  ws.views = [{ showGridLines: false }]

  const closed = positions.filter((p) => p.status === 'closed' && p.exit_price != null)
  const byType: Record<string, ReportPosition[]> = {}
  for (const p of closed) {
    const et = inferExitType(p.close_reasoning)
    if (!byType[et]) byType[et] = []
    byType[et].push(p)
  }

  sectionTitle(ws, 1, 'Exit type performance', 7)
  ws.getColumn(1).width = 16
  const cols1 = [
    'Exit Type',
    'Count',
    'Win Rate %',
    'Avg P&L €',
    'Total P&L €',
    'Avg Hold (min)',
    '% of Exits',
  ]
  const widths1 = [16, 9, 12, 14, 14, 16, 12]
  headerStyle(ws, 2, cols1)
  widths1.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const total = closed.length
  const summaryRows = Object.entries(byType).map(([et, trades]) => {
    const pnls = trades.map((p) => p.realized_pnl ?? 0)
    const wins = pnls.filter((v) => v > 0).length
    const holds = trades
      .map((p) => minutesBetween(p.opened_at, p.closed_at))
      .filter((h): h is number => h != null)
    return {
      type: et,
      count: trades.length,
      winRate: Number(((wins / trades.length) * 100).toFixed(1)),
      avgPnl: Number((pnls.reduce((s, v) => s + v, 0) / pnls.length).toFixed(4)),
      totalPnl: Number(pnls.reduce((s, v) => s + v, 0).toFixed(4)),
      avgHold: holds.length
        ? Number((holds.reduce((s, h) => s + h, 0) / holds.length).toFixed(1))
        : null,
      pctExits: Number(((trades.length / total) * 100).toFixed(1)),
    }
  })
  summaryRows.sort((a, b) => b.totalPnl - a.totalPnl)

  for (let i = 0; i < summaryRows.length; i++) {
    const r = summaryRows[i]
    const row = i + 3
    const vals = [r.type, r.count, r.winRate, r.avgPnl, r.totalPnl, r.avgHold, r.pctExits]
    vals.forEach((val, col) => {
      const cell = ws.getCell(row, col + 1)
      cell.value = val
      cell.font = { name: FONT_UI, size: 10 }
      if (col === 3) {
        cell.font = {
          name: FONT_UI,
          size: 10,
          color: { argb: r.avgPnl > 0 ? COLOR_WIN : COLOR_LOSS },
        }
      }
    })
    ws.getRow(row).height = 16
  }

  const stagnant = closed.filter((p) =>
    (p.close_reasoning ?? '').toLowerCase().includes('stagnant')
  )
  if (stagnant.length > 0) {
    let sr = 3 + summaryRows.length + 2
    sectionTitle(ws, sr, 'Stagnant exit detail — were these leaving money on the table?', 8)
    sr++
    const cols2 = [
      'Ticker',
      'Entry €',
      'Exit €',
      'P&L €',
      'P&L %',
      'HWM €',
      'Peak Gain % (HWM)',
      'Hold (min)',
    ]
    const widths2 = [14, 10, 10, 10, 10, 10, 18, 12]
    headerStyle(ws, sr, cols2)
    widths2.forEach((w, i) => {
      ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, w)
    })
    sr++

    for (const p of stagnant) {
      const entry = p.entry_price ?? 0
      const exit = p.exit_price ?? 0
      const hwm = p.high_water_mark ?? exit
      const pnl = p.realized_pnl ?? 0
      const pnlPct = entry ? Number((((exit - entry) / entry) * 100).toFixed(3)) : null
      const peakPct = entry && hwm ? Number((((hwm - entry) / entry) * 100).toFixed(3)) : null
      const hold = minutesBetween(p.opened_at, p.closed_at)

      const vals = [
        p.ticker,
        Number(entry.toFixed(4)),
        Number(exit.toFixed(4)),
        Number(pnl.toFixed(4)),
        pnlPct,
        Number(hwm.toFixed(4)),
        peakPct,
        hold,
      ]
      vals.forEach((val, col) => {
        const cell = ws.getCell(sr, col + 1)
        cell.value = val
        cell.font = { name: FONT_UI, size: 10 }
      })
      ws.getRow(sr).height = 16
      sr++
    }
  }
}

function buildAiCostSheet(
  wb: ExcelJS.Workbook,
  aiUsage: ReportAiUsage[],
  decisions: ReportDecision[]
) {
  const ws = wb.addWorksheet('AI Cost')
  ws.views = [{ showGridLines: false }]

  const cols = [
    'Timestamp',
    'Model',
    'Decision Action',
    'Input Tokens',
    'Output Tokens',
    'Cost USD',
  ]
  const widths = [24, 22, 18, 14, 14, 12]
  headerStyle(ws, 1, cols)
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const decisionMap = new Map(decisions.map((d) => [d.id, d]))

  for (let i = 0; i < aiUsage.length; i++) {
    const u = aiUsage[i]
    const d = u.decision_id != null ? decisionMap.get(u.decision_id) : null
    const row = i + 2
    const vals = [
      u.timestamp,
      u.model ?? '—',
      d?.action ?? '—',
      u.input_tokens ?? 0,
      u.output_tokens ?? 0,
      u.total_cost_usd != null ? Number(u.total_cost_usd.toFixed(5)) : 0,
    ]
    vals.forEach((val, col) => {
      const cell = ws.getCell(row, col + 1)
      cell.value = val
      cell.font = { name: FONT_UI, size: 10 }
    })
    ws.getRow(row).height = 15
  }

  const totalRow = aiUsage.length + 2
  const tcell = ws.getCell(totalRow, 1)
  tcell.value = 'TOTAL'
  tcell.font = { name: FONT_UI, bold: true, size: 10 }

  ws.getCell(totalRow, 4).value = aiUsage.reduce((s, u) => s + (u.input_tokens ?? 0), 0)
  ws.getCell(totalRow, 4).font = { name: FONT_UI, bold: true, size: 10 }
  ws.getCell(totalRow, 5).value = aiUsage.reduce((s, u) => s + (u.output_tokens ?? 0), 0)
  ws.getCell(totalRow, 5).font = { name: FONT_UI, bold: true, size: 10 }
  ws.getCell(totalRow, 6).value = Number(
    aiUsage.reduce((s, u) => s + (u.total_cost_usd ?? 0), 0).toFixed(5)
  )
  ws.getCell(totalRow, 6).font = { name: FONT_UI, bold: true, size: 10 }
}

function buildDecisionActivitySheet(wb: ExcelJS.Workbook, decisions: ReportDecision[]) {
  const ws = wb.addWorksheet('Decision Activity')
  ws.views = [{ showGridLines: false }]

  const byHour: Record<number, { buy: number; sell: number; hold: number; total: number }> = {}
  for (const d of decisions) {
    try {
      const hour = new Date(d.timestamp).getUTCHours()
      if (!byHour[hour]) byHour[hour] = { buy: 0, sell: 0, hold: 0, total: 0 }
      const bucket = byHour[hour]
      if (d.action === 'buy') bucket.buy++
      else if (d.action === 'sell') bucket.sell++
      else bucket.hold++
      bucket.total++
    } catch {
      // skip
    }
  }

  sectionTitle(ws, 1, 'Decisions by hour of day (UTC)', 6)
  ws.getColumn(1).width = 14
  const cols = ['Hour (UTC)', 'Buy', 'Sell', 'Hold', 'Total', 'Buy Rate %']
  const widths = [14, 9, 9, 9, 9, 12]
  headerStyle(ws, 2, cols)
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  let r = 3
  for (const hour of Object.keys(byHour)
    .map(Number)
    .sort((a, b) => a - b)) {
    const b = byHour[hour]
    const buyRate = b.total ? Number(((b.buy / b.total) * 100).toFixed(1)) : 0
    const vals = [`${String(hour).padStart(2, '0')}:00`, b.buy, b.sell, b.hold, b.total, buyRate]
    vals.forEach((val, col) => {
      const cell = ws.getCell(r, col + 1)
      cell.value = val
      cell.font = { name: FONT_UI, size: 10 }
    })
    ws.getRow(r).height = 16
    r++
  }
}

export async function generateReport(params: ReportParams, userLabel: string): Promise<Buffer> {
  const [positions, decisions, aiUsage] = await Promise.all([
    loadReportPositions(params.userId, params.from, params.to),
    loadReportDecisions(params.userId, params.from, params.to),
    loadReportAiUsage(params.userId, params.from, params.to),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Trader Analytics'
  wb.created = new Date()

  buildSummarySheet(wb, positions, decisions, aiUsage, params.from, params.to, userLabel)
  buildTradeLogSheet(wb, positions)
  buildTickerBreakdownSheet(wb, positions)
  buildExitAnalysisSheet(wb, positions)
  buildAiCostSheet(wb, aiUsage, decisions)
  buildDecisionActivitySheet(wb, decisions)

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
