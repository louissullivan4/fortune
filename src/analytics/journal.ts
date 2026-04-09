import { getPool } from '../db.js'
import type { TickerSignal } from '../strategy/signals.js'
import type { PortfolioSnapshot } from '../api/trading212.js'

export interface DecisionRecord {
  id?: number
  timestamp: string
  action: 'buy' | 'sell' | 'hold'
  ticker: string | null
  quantity: number | null
  estimatedPrice: number | null
  reasoning: string
  signalsJson: string
  portfolioJson: string
}

export interface OrderRecord {
  id?: number
  decisionId: number
  t212OrderId: string | null
  status: string
  fillPrice: number | null
  fillQuantity: number | null
  timestamp: string
}

// ── Decisions ──────────────────────────────────────────────────────────────

export async function logDecision(record: Omit<DecisionRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO decisions (timestamp, action, ticker, quantity, estimated_price, reasoning, signals_json, portfolio_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [record.timestamp, record.action, record.ticker, record.quantity, record.estimatedPrice,
     record.reasoning, record.signalsJson, record.portfolioJson]
  )
  return result.rows[0].id
}

// ── Orders ─────────────────────────────────────────────────────────────────

export async function logOrder(record: Omit<OrderRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO orders (decision_id, t212_order_id, status, fill_price, fill_quantity, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [record.decisionId, record.t212OrderId, record.status, record.fillPrice, record.fillQuantity, record.timestamp]
  )
  return result.rows[0].id
}

// ── Daily snapshots ────────────────────────────────────────────────────────

export async function upsertDailySnapshot(date: string, openValue: number, aiOpenValue: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO daily_snapshots (date, open_value, ai_open_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (date) DO NOTHING`,
    [date, openValue, aiOpenValue]
  )
}

export async function updateDailyClose(date: string, closeValue: number, pnl: number, aiCloseValue?: number): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold' AND timestamp::date = $1::date`,
    [date]
  )
  const tradesCount = Number(res.rows[0].c)
  await pool.query(
    `UPDATE daily_snapshots
     SET close_value = $1, pnl = $2, trades_count = $3, ai_close_value = COALESCE($4, ai_close_value)
     WHERE date = $5`,
    [closeValue, pnl, tradesCount, aiCloseValue ?? null, date]
  )
}

export async function resetDailySnapshot(date: string): Promise<void> {
  const pool = getPool()
  await pool.query('DELETE FROM daily_snapshots WHERE date = $1', [date])
}

export async function getDailyOpenValue(date: string): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ open_value: number }>(
    'SELECT open_value FROM daily_snapshots WHERE date = $1',
    [date]
  )
  return res.rows[0]?.open_value ?? null
}

export interface RecentDecision {
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  reasoning: string
}

export async function getRecentDecisions(limit = 5): Promise<RecentDecision[]> {
  const pool = getPool()
  const res = await pool.query<RecentDecision>(
    'SELECT timestamp, action, ticker, quantity, reasoning FROM decisions ORDER BY id DESC LIMIT $1',
    [limit]
  )
  return res.rows
}

export interface DailyStats {
  date: string
  openValue: number
  closeValue: number | null
  tradesCount: number
  pnl: number | null
}

export async function getDailyStats(date: string): Promise<DailyStats | null> {
  const pool = getPool()
  const res = await pool.query<{
    date: string; open_value: number; close_value: number | null; trades_count: number; pnl: number | null
  }>('SELECT * FROM daily_snapshots WHERE date = $1', [date])
  const row = res.rows[0]
  if (!row) return null
  return {
    date: row.date,
    openValue: row.open_value,
    closeValue: row.close_value,
    tradesCount: row.trades_count,
    pnl: row.pnl,
  }
}

export async function getDailyValues(limit = 30): Promise<Array<{ date: string; value: number }>> {
  const pool = getPool()
  const res = await pool.query<{ date: string; value: number }>(
    `SELECT date,
       COALESCE(ai_close_value, ai_open_value, close_value, open_value) AS value
     FROM daily_snapshots
     ORDER BY date DESC
     LIMIT $1`,
    [limit]
  )
  return res.rows.reverse()
}

export async function getAllTimeStats(): Promise<{ totalDecisions: number; totalTrades: number; daysTraded: number }> {
  const pool = getPool()
  const [d, t, s] = await Promise.all([
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM decisions'),
    pool.query<{ c: string }>("SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold'"),
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM daily_snapshots'),
  ])
  return {
    totalDecisions: Number(d.rows[0].c),
    totalTrades:    Number(t.rows[0].c),
    daysTraded:     Number(s.rows[0].c),
  }
}

// ── AI Portfolio ───────────────────────────────────────────────────────────

export interface AiPortfolioConfig {
  startedAt: string
  initialBudget: number
}

export async function initAiPortfolio(initialBudget: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO ai_portfolio_config (id, started_at, initial_budget)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET started_at = EXCLUDED.started_at, initial_budget = EXCLUDED.initial_budget`,
    [new Date().toISOString(), initialBudget]
  )
}

export async function getAiPortfolioConfig(): Promise<AiPortfolioConfig | null> {
  const pool = getPool()
  const res = await pool.query<{ started_at: string; initial_budget: number }>(
    'SELECT started_at, initial_budget FROM ai_portfolio_config WHERE id = 1'
  )
  const row = res.rows[0]
  if (!row) return null
  return { startedAt: row.started_at, initialBudget: row.initial_budget }
}

export interface AiTrade {
  timestamp: string
  action: 'buy' | 'sell'
  ticker: string
  quantity: number
  estimatedPrice: number | null
  estimatedValue: number | null
  orderStatus: string | null
}

export async function getAiTrades(): Promise<AiTrade[]> {
  const pool = getPool()
  const res = await pool.query<{
    timestamp: string; action: 'buy' | 'sell'; ticker: string
    quantity: number; estimatedprice: number | null; orderstatus: string | null
  }>(
    `SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price AS estimatedprice,
            o.status AS orderstatus
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.action IN ('buy', 'sell') AND d.ticker IS NOT NULL
     ORDER BY d.id ASC`
  )
  return res.rows.map((r) => ({
    timestamp:      r.timestamp,
    action:         r.action,
    ticker:         r.ticker,
    quantity:       Number(r.quantity),
    estimatedPrice: r.estimatedprice != null ? Number(r.estimatedprice) : null,
    estimatedValue: r.estimatedprice != null ? Number(r.estimatedprice) * Number(r.quantity) : null,
    orderStatus:    r.orderstatus,
  }))
}

export interface AiNetPosition {
  ticker: string
  netQuantity: number
}

export async function getAiNetPositions(): Promise<AiNetPosition[]> {
  const pool = getPool()
  const res = await pool.query<{ ticker: string; net_quantity: string }>(
    `SELECT d.ticker,
            SUM(CASE WHEN d.action = 'buy' THEN d.quantity ELSE -d.quantity END) AS net_quantity
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.action IN ('buy', 'sell')
       AND d.ticker IS NOT NULL
       AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
     GROUP BY d.ticker
     HAVING SUM(CASE WHEN d.action = 'buy' THEN d.quantity ELSE -d.quantity END) > 0`
  )
  return res.rows.map((r) => ({ ticker: r.ticker, netQuantity: Number(r.net_quantity) }))
}

// ── AI Position tracking ───────────────────────────────────────────────────

export interface AiPosition {
  id: number
  ticker: string
  openedAt: string
  quantity: number
  entryPrice: number | null
  highWaterMark: number | null
  closedAt: string | null
  exitPrice: number | null
  realizedPnl: number | null
  status: 'open' | 'closed'
}

function mapAiPosition(r: {
  id: number; ticker: string; opened_at: string; quantity: number; entry_price: number | null
  high_water_mark: number | null; closed_at: string | null; exit_price: number | null
  realized_pnl: number | null; status: string
}): AiPosition {
  return {
    id: r.id, ticker: r.ticker, openedAt: r.opened_at, quantity: Number(r.quantity),
    entryPrice: r.entry_price != null ? Number(r.entry_price) : null,
    highWaterMark: r.high_water_mark != null ? Number(r.high_water_mark) : null,
    closedAt: r.closed_at, exitPrice: r.exit_price != null ? Number(r.exit_price) : null,
    realizedPnl: r.realized_pnl != null ? Number(r.realized_pnl) : null,
    status: r.status as 'open' | 'closed',
  }
}

export async function openAiPosition(ticker: string, quantity: number, entryPrice: number | null, openedAt: string): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ai_positions (ticker, opened_at, quantity, entry_price, high_water_mark, status)
     VALUES ($1, $2, $3, $4, $5, 'open')
     RETURNING id`,
    [ticker, openedAt, quantity, entryPrice, entryPrice]
  )
  return result.rows[0].id
}

export async function updateHighWaterMark(ticker: string, price: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE ai_positions
     SET high_water_mark = $1
     WHERE ticker = $2 AND status = 'open'
       AND (high_water_mark IS NULL OR $1 > high_water_mark)`,
    [price, ticker]
  )
}

export async function getHighWaterMark(ticker: string): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ high_water_mark: number | null }>(
    `SELECT high_water_mark FROM ai_positions WHERE ticker = $1 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [ticker]
  )
  return res.rows[0]?.high_water_mark ?? null
}

export async function closeAiPosition(ticker: string, exitPrice: number | null, closedAt: string): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ id: number; quantity: number; entry_price: number | null }>(
    `SELECT id, quantity, entry_price FROM ai_positions
     WHERE ticker = $1 AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1`,
    [ticker]
  )
  const open = res.rows[0]
  if (!open) return

  const realizedPnl =
    exitPrice != null && open.entry_price != null
      ? (exitPrice - Number(open.entry_price)) * Number(open.quantity)
      : null

  await pool.query(
    `UPDATE ai_positions SET status = 'closed', closed_at = $1, exit_price = $2, realized_pnl = $3
     WHERE id = $4`,
    [closedAt, exitPrice, realizedPnl, open.id]
  )
}

export async function getOpenAiPositions(): Promise<AiPosition[]> {
  const pool = getPool()
  const res = await pool.query(
    `SELECT * FROM ai_positions WHERE status = 'open' ORDER BY opened_at ASC`
  )
  return res.rows.map(mapAiPosition)
}

export async function getClosedAiPositions(): Promise<AiPosition[]> {
  const pool = getPool()
  const res = await pool.query(
    `SELECT * FROM ai_positions WHERE status = 'closed' ORDER BY closed_at DESC`
  )
  return res.rows.map(mapAiPosition)
}

export async function reconcileAiPositions(): Promise<{ inserted: number }> {
  const pool = getPool()

  const trades = (await pool.query<{
    timestamp: string; action: 'buy' | 'sell'; ticker: string; quantity: number; estimated_price: number | null
  }>(
    `SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.action IN ('buy', 'sell')
       AND d.ticker IS NOT NULL
       AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
     ORDER BY d.id ASC`
  )).rows

  const existing = new Set(
    (await pool.query<{ key: string }>(
      `SELECT ticker || '|' || opened_at AS key FROM ai_positions`
    )).rows.map((r) => r.key)
  )

  let inserted = 0
  for (const t of trades) {
    if (t.action === 'buy') {
      const key = `${t.ticker}|${t.timestamp}`
      if (existing.has(key)) continue
      await openAiPosition(t.ticker, t.quantity, t.estimated_price, t.timestamp)
      existing.add(key)
      inserted++
    } else {
      await closeAiPosition(t.ticker, t.estimated_price, t.timestamp)
      inserted++
    }
  }
  return { inserted }
}

// ── Paginated API queries ──────────────────────────────────────────────────

export interface DecisionRow {
  id: number
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  estimatedPrice: number | null
  reasoning: string
  signalsJson: string
  portfolioJson: string
  orderStatus: string | null
  orderId: string | null
}

export async function getDecisionsPaginated(page: number, limit: number): Promise<{ data: DecisionRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit
  const [countRes, dataRes] = await Promise.all([
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM decisions'),
    pool.query<{
      id: number; timestamp: string; action: string; ticker: string | null; quantity: number | null
      estimatedprice: number | null; reasoning: string; signalsjson: string; portfoliojson: string
      orderstatus: string | null; orderid: string | null
    }>(
      `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
              d.estimated_price AS estimatedprice, d.reasoning,
              d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
              o.status AS orderstatus, o.t212_order_id AS orderid
       FROM decisions d
       LEFT JOIN orders o ON o.decision_id = d.id
       ORDER BY d.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
  ])
  const total = Number(countRes.rows[0].c)
  const data: DecisionRow[] = dataRes.rows.map((r) => ({
    id: r.id, timestamp: r.timestamp, action: r.action, ticker: r.ticker,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    estimatedPrice: r.estimatedprice != null ? Number(r.estimatedprice) : null,
    reasoning: r.reasoning, signalsJson: r.signalsjson, portfolioJson: r.portfoliojson,
    orderStatus: r.orderstatus, orderId: r.orderid,
  }))
  return { data, total }
}

export async function getDecisionById(id: number): Promise<DecisionRow | null> {
  const pool = getPool()
  const res = await pool.query<{
    id: number; timestamp: string; action: string; ticker: string | null; quantity: number | null
    estimatedprice: number | null; reasoning: string; signalsjson: string; portfoliojson: string
    orderstatus: string | null; orderid: string | null
  }>(
    `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
            d.estimated_price AS estimatedprice, d.reasoning,
            d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
            o.status AS orderstatus, o.t212_order_id AS orderid
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.id = $1`,
    [id]
  )
  const r = res.rows[0]
  if (!r) return null
  return {
    id: r.id, timestamp: r.timestamp, action: r.action, ticker: r.ticker,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    estimatedPrice: r.estimatedprice != null ? Number(r.estimatedprice) : null,
    reasoning: r.reasoning, signalsJson: r.signalsjson, portfolioJson: r.portfoliojson,
    orderStatus: r.orderstatus, orderId: r.orderid,
  }
}

export interface OrderRow {
  id: number
  decisionId: number
  t212OrderId: string | null
  status: string
  fillPrice: number | null
  fillQuantity: number | null
  timestamp: string
  ticker: string | null
  action: string
}

export async function getOrdersPaginated(page: number, limit: number): Promise<{ data: OrderRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit
  const [countRes, dataRes] = await Promise.all([
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM orders'),
    pool.query<{
      id: number; decisionid: number; t212orderid: string | null; status: string
      fillprice: number | null; fillquantity: number | null; timestamp: string
      ticker: string | null; action: string
    }>(
      `SELECT o.id, o.decision_id AS decisionid, o.t212_order_id AS t212orderid,
              o.status, o.fill_price AS fillprice, o.fill_quantity AS fillquantity,
              o.timestamp, d.ticker, d.action
       FROM orders o
       JOIN decisions d ON d.id = o.decision_id
       ORDER BY o.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
  ])
  const total = Number(countRes.rows[0].c)
  const data: OrderRow[] = dataRes.rows.map((r) => ({
    id: r.id, decisionId: r.decisionid, t212OrderId: r.t212orderid, status: r.status,
    fillPrice: r.fillprice != null ? Number(r.fillprice) : null,
    fillQuantity: r.fillquantity != null ? Number(r.fillquantity) : null,
    timestamp: r.timestamp, ticker: r.ticker, action: r.action,
  }))
  return { data, total }
}

// ── AI usage tracking ──────────────────────────────────────────────────────

export interface AiUsageRecord {
  decisionId: number
  timestamp: string
  model: string
  inputTokens: number
  outputTokens: number
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
}

export async function logAiUsage(record: AiUsageRecord): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO ai_usage
       (decision_id, timestamp, model, input_tokens, output_tokens, input_cost_usd, output_cost_usd, total_cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [record.decisionId, record.timestamp, record.model, record.inputTokens, record.outputTokens,
     record.inputCostUsd, record.outputCostUsd, record.totalCostUsd]
  )
}

export interface AiUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  callCount: number
  avgCostPerCallUsd: number
}

export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const pool = getPool()
  const res = await pool.query<{
    totalinputtokens: string; totaloutputtokens: string; totalcostusd: string; callcount: string
  }>(
    `SELECT
       COALESCE(SUM(input_tokens),    0) AS totalinputtokens,
       COALESCE(SUM(output_tokens),   0) AS totaloutputtokens,
       COALESCE(SUM(total_cost_usd),  0) AS totalcostusd,
       COUNT(*)                          AS callcount
     FROM ai_usage`
  )
  const r = res.rows[0]
  const callCount = Number(r.callcount)
  const totalCostUsd = Number(r.totalcostusd)
  return {
    totalInputTokens:  Number(r.totalinputtokens),
    totalOutputTokens: Number(r.totaloutputtokens),
    totalCostUsd,
    callCount,
    avgCostPerCallUsd: callCount > 0 ? totalCostUsd / callCount : 0,
  }
}

export async function getAiUsageByDay(limit = 30): Promise<Array<{ date: string; costUsd: number; calls: number }>> {
  const pool = getPool()
  const res = await pool.query<{ date: string; costusd: string; calls: string }>(
    `SELECT timestamp::date AS date,
            COALESCE(SUM(total_cost_usd), 0) AS costusd,
            COUNT(*) AS calls
     FROM ai_usage
     GROUP BY timestamp::date
     ORDER BY date DESC
     LIMIT $1`,
    [limit]
  )
  return res.rows.map((r) => ({ date: r.date, costUsd: Number(r.costusd), calls: Number(r.calls) }))
}

export async function getIntradayValues(hours: number): Promise<Array<{ timestamp: string; value: number }>> {
  const pool = getPool()
  const res = await pool.query<{ timestamp: string; portfolio_json: string }>(
    `SELECT timestamp, portfolio_json
     FROM decisions
     WHERE timestamp::timestamptz >= NOW() - ($1 || ' hours')::interval
     ORDER BY timestamp ASC`,
    [hours]
  )
  return res.rows.flatMap((r) => {
    try {
      const p = JSON.parse(r.portfolio_json) as { aiValue?: number; totalValue?: number }
      const value = p.aiValue ?? p.totalValue
      if (typeof value !== 'number') return []
      return [{ timestamp: r.timestamp, value: Number(value.toFixed(2)) }]
    } catch {
      return []
    }
  })
}

export async function getOrdersForDay(date: string): Promise<Array<{
  action: string
  ticker: string | null
  quantity: number | null
  reasoning: string
  status: string | null
  fillPrice: number | null
}>> {
  const pool = getPool()
  const res = await pool.query<{
    action: string; ticker: string | null; quantity: number | null
    reasoning: string; status: string | null; fillprice: number | null
  }>(
    `SELECT d.action, d.ticker, d.quantity, d.reasoning, o.status, o.fill_price AS fillprice
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.timestamp::date = $1::date AND d.action != 'hold'
     ORDER BY d.id`,
    [date]
  )
  return res.rows.map((r) => ({ ...r, fillPrice: r.fillprice != null ? Number(r.fillprice) : null }))
}
