import { getPool } from '../db.js'
import type { BacktestConfig, BacktestMetrics } from './types.js'

export type BacktestStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface BacktestRow {
  id: number
  userId: string
  name: string
  status: BacktestStatus
  progressPct: number
  configJson: BacktestConfig
  startDate: string
  endDate: string
  initialCash: number
  finalValue: number | null
  realizedPnl: number | null
  totalReturnPct: number | null
  maxDrawdownPct: number | null
  winRate: number | null
  tradesCount: number | null
  sharpe: number | null
  metricsJson: BacktestMetrics | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  market: string
}

interface RawRow {
  id: number
  user_id: string
  name: string
  status: BacktestStatus
  progress_pct: number
  config_json: BacktestConfig
  start_date: string | Date
  end_date: string | Date
  initial_cash: string
  final_value: string | null
  realized_pnl: string | null
  total_return_pct: string | null
  max_drawdown_pct: string | null
  win_rate: string | null
  trades_count: number | null
  sharpe: string | null
  metrics_json: BacktestMetrics | null
  error_message: string | null
  created_at: string | Date
  started_at: string | Date | null
  completed_at: string | Date | null
  market_code: string
}

function asIsoDate(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
}

function asIso(v: string | Date | null): string | null {
  if (v === null) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

function toNumOrNull(v: string | null): number | null {
  return v === null ? null : Number(v)
}

function fromRow(r: RawRow): BacktestRow {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    status: r.status,
    progressPct: r.progress_pct,
    configJson: r.config_json,
    startDate: asIsoDate(r.start_date),
    endDate: asIsoDate(r.end_date),
    initialCash: Number(r.initial_cash),
    finalValue: toNumOrNull(r.final_value),
    realizedPnl: toNumOrNull(r.realized_pnl),
    totalReturnPct: toNumOrNull(r.total_return_pct),
    maxDrawdownPct: toNumOrNull(r.max_drawdown_pct),
    winRate: toNumOrNull(r.win_rate),
    tradesCount: r.trades_count,
    sharpe: toNumOrNull(r.sharpe),
    metricsJson: r.metrics_json,
    errorMessage: r.error_message,
    createdAt: asIso(r.created_at)!,
    startedAt: asIso(r.started_at),
    completedAt: asIso(r.completed_at),
    market: r.market_code,
  }
}

const LIST_COLUMNS = `
  id, user_id, name, status, progress_pct, config_json, start_date, end_date,
  initial_cash, final_value, realized_pnl, total_return_pct, max_drawdown_pct,
  win_rate, trades_count, sharpe, error_message, created_at, started_at,
  completed_at, market_code, NULL::jsonb AS metrics_json
`

const FULL_COLUMNS = `
  id, user_id, name, status, progress_pct, config_json, start_date, end_date,
  initial_cash, final_value, realized_pnl, total_return_pct, max_drawdown_pct,
  win_rate, trades_count, sharpe, error_message, created_at, started_at,
  completed_at, market_code, metrics_json
`

export async function createBacktest(userId: string, config: BacktestConfig): Promise<BacktestRow> {
  const pool = getPool()
  const result = await pool.query<RawRow>(
    `INSERT INTO backtests (user_id, name, status, config_json, start_date, end_date, initial_cash, market_code)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
     RETURNING ${FULL_COLUMNS}`,
    [
      userId,
      config.name,
      JSON.stringify(config),
      config.startDate,
      config.endDate,
      config.initialCash,
      config.market,
    ]
  )
  return fromRow(result.rows[0])
}

export async function listBacktests(
  userId: string,
  page: number,
  limit: number,
  market?: string
): Promise<{ data: BacktestRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit
  const params: unknown[] = [userId]
  let where = 'WHERE user_id = $1'
  if (market !== undefined) {
    params.push(market)
    where += ` AND market_code = $${params.length}`
  }
  const [rowsRes, countRes] = await Promise.all([
    pool.query<RawRow>(
      `SELECT ${LIST_COLUMNS} FROM backtests
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM backtests ${where}`, params),
  ])
  return { data: rowsRes.rows.map(fromRow), total: Number(countRes.rows[0].c) }
}

export async function getBacktest(id: number, userId: string): Promise<BacktestRow | null> {
  const pool = getPool()
  const result = await pool.query<RawRow>(
    `SELECT ${FULL_COLUMNS} FROM backtests WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return result.rows[0] ? fromRow(result.rows[0]) : null
}

export async function deleteBacktest(id: number, userId: string): Promise<boolean> {
  const pool = getPool()
  const result = await pool.query(`DELETE FROM backtests WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function updateBacktestProgress(id: number, progressPct: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE backtests SET progress_pct = $1, status = 'running', started_at = COALESCE(started_at, NOW())
     WHERE id = $2`,
    [progressPct, id]
  )
}

export async function completeBacktest(
  id: number,
  metrics: import('./types.js').BacktestMetrics
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE backtests SET
       status = 'completed',
       progress_pct = 100,
       final_value = $1,
       realized_pnl = $2,
       total_return_pct = $3,
       max_drawdown_pct = $4,
       win_rate = $5,
       trades_count = $6,
       sharpe = $7,
       metrics_json = $8,
       completed_at = NOW()
     WHERE id = $9`,
    [
      metrics.finalValue,
      metrics.realizedPnl,
      metrics.totalReturnPct,
      metrics.maxDrawdownPct,
      metrics.winRate,
      metrics.tradesCount,
      metrics.sharpe,
      JSON.stringify(metrics),
      id,
    ]
  )
}

export async function failBacktest(id: number, message: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE backtests SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
    [message.slice(0, 2000), id]
  )
}
