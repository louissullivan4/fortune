import { getPool } from '../db.js'

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
  userId: string
}

export interface OrderRecord {
  id?: number
  decisionId: number
  t212OrderId: string | null
  status: string
  fillPrice: number | null
  fillQuantity: number | null
  timestamp: string
  userId: string
}

// ── Decisions ──────────────────────────────────────────────────────────────

export async function logDecision(record: Omit<DecisionRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO decisions (timestamp, action, ticker, quantity, estimated_price, reasoning, signals_json, portfolio_json, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      record.timestamp,
      record.action,
      record.ticker,
      record.quantity,
      record.estimatedPrice,
      record.reasoning,
      record.signalsJson,
      record.portfolioJson,
      record.userId,
    ]
  )
  return result.rows[0].id
}

// ── Orders ─────────────────────────────────────────────────────────────────

export async function logOrder(record: Omit<OrderRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO orders (decision_id, t212_order_id, status, fill_price, fill_quantity, timestamp, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      record.decisionId,
      record.t212OrderId,
      record.status,
      record.fillPrice,
      record.fillQuantity,
      record.timestamp,
      record.userId,
    ]
  )
  return result.rows[0].id
}

// ── Daily snapshots ────────────────────────────────────────────────────────

export async function upsertDailySnapshot(
  date: string,
  openValue: number,
  aiOpenValue: number,
  userId: string
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO daily_snapshots (date, open_value, ai_open_value, user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, date) WHERE user_id IS NOT NULL DO NOTHING`,
    [date, openValue, aiOpenValue, userId]
  )
}

export async function updateDailyClose(
  date: string,
  closeValue: number,
  pnl: number,
  userId: string,
  aiCloseValue?: number
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold' AND timestamp::date = $1::date AND user_id = $2`,
    [date, userId]
  )
  const tradesCount = Number(res.rows[0].c)
  await pool.query(
    `UPDATE daily_snapshots
     SET close_value = $1, pnl = $2, trades_count = $3, ai_close_value = COALESCE($4, ai_close_value)
     WHERE date = $5 AND user_id = $6`,
    [closeValue, pnl, tradesCount, aiCloseValue ?? null, date, userId]
  )
}

export async function getDailyOpenValue(date: string, userId: string): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ open_value: number }>(
    'SELECT open_value FROM daily_snapshots WHERE date = $1 AND user_id = $2',
    [date, userId]
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

export async function getRecentDecisions(userId: string, limit = 5): Promise<RecentDecision[]> {
  const pool = getPool()
  const res = await pool.query<RecentDecision>(
    'SELECT timestamp, action, ticker, quantity, reasoning FROM decisions WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
    [userId, limit]
  )
  return res.rows
}

// ── AI Portfolio ───────────────────────────────────────────────────────────

export interface AiPortfolioConfig {
  startedAt: string
  initialBudget: number
}

export async function initAiPortfolio(userId: string, initialBudget: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO ai_portfolio_config (started_at, initial_budget, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) WHERE user_id IS NOT NULL
     DO UPDATE SET started_at = EXCLUDED.started_at, initial_budget = EXCLUDED.initial_budget`,
    [new Date().toISOString(), initialBudget, userId]
  )
}

export async function getAiPortfolioConfig(userId: string): Promise<AiPortfolioConfig | null> {
  const pool = getPool()
  const res = await pool.query<{ started_at: string; initial_budget: number }>(
    'SELECT started_at, initial_budget FROM ai_portfolio_config WHERE user_id = $1',
    [userId]
  )
  const row = res.rows[0]
  if (!row) return null
  return { startedAt: row.started_at, initialBudget: row.initial_budget }
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
  id: number
  ticker: string
  opened_at: string
  quantity: number
  entry_price: number | null
  high_water_mark: number | null
  closed_at: string | null
  exit_price: number | null
  realized_pnl: number | null
  status: string
}): AiPosition {
  return {
    id: r.id,
    ticker: r.ticker,
    openedAt: r.opened_at,
    quantity: Number(r.quantity),
    entryPrice: r.entry_price != null ? Number(r.entry_price) : null,
    highWaterMark: r.high_water_mark != null ? Number(r.high_water_mark) : null,
    closedAt: r.closed_at,
    exitPrice: r.exit_price != null ? Number(r.exit_price) : null,
    realizedPnl: r.realized_pnl != null ? Number(r.realized_pnl) : null,
    status: r.status as 'open' | 'closed',
  }
}

export async function openAiPosition(
  ticker: string,
  quantity: number,
  entryPrice: number | null,
  openedAt: string,
  userId: string
): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ai_positions (ticker, opened_at, quantity, entry_price, high_water_mark, status, user_id)
     VALUES ($1, $2, $3, $4, $5, 'open', $6)
     RETURNING id`,
    [ticker, openedAt, quantity, entryPrice, entryPrice, userId]
  )
  return result.rows[0].id
}

export async function updateHighWaterMark(
  ticker: string,
  price: number,
  userId: string
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE ai_positions
     SET high_water_mark = $1
     WHERE ticker = $2 AND status = 'open' AND user_id = $3
       AND (high_water_mark IS NULL OR $1 > high_water_mark)`,
    [price, ticker, userId]
  )
}

export async function closeAiPosition(
  ticker: string,
  exitPrice: number | null,
  closedAt: string,
  userId: string
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ id: number; quantity: number; entry_price: number | null }>(
    `SELECT id, quantity, entry_price FROM ai_positions
     WHERE ticker = $1 AND status = 'open' AND user_id = $2
     ORDER BY opened_at DESC LIMIT 1`,
    [ticker, userId]
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

export async function closeAllAiPositions(
  ticker: string,
  exitPrice: number | null,
  closedAt: string,
  userId: string
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ id: number; quantity: number; entry_price: number | null }>(
    `SELECT id, quantity, entry_price FROM ai_positions
     WHERE ticker = $1 AND status = 'open' AND user_id = $2`,
    [ticker, userId]
  )
  for (const open of res.rows) {
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
}

export async function getOpenAiPositions(userId: string): Promise<AiPosition[]> {
  const pool = getPool()
  const res = await pool.query(
    `SELECT * FROM ai_positions WHERE status = 'open' AND user_id = $1 ORDER BY opened_at ASC`,
    [userId]
  )
  return res.rows.map(mapAiPosition)
}

export async function getClosedAiPositions(userId: string): Promise<AiPosition[]> {
  const pool = getPool()
  const res = await pool.query(
    `SELECT * FROM ai_positions WHERE status = 'closed' AND user_id = $1 ORDER BY closed_at DESC`,
    [userId]
  )
  return res.rows.map(mapAiPosition)
}

export async function reconcileAiPositions(userId: string): Promise<{ inserted: number }> {
  const pool = getPool()

  const trades = (
    await pool.query<{
      timestamp: string
      action: 'buy' | 'sell'
      ticker: string
      quantity: number
      estimated_price: number | null
    }>(
      `SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price
       FROM decisions d
       LEFT JOIN orders o ON o.decision_id = d.id
       WHERE d.action IN ('buy', 'sell')
         AND d.ticker IS NOT NULL
         AND d.user_id = $1
         AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
       ORDER BY d.id ASC`,
      [userId]
    )
  ).rows

  const existing = new Set(
    (
      await pool.query<{ key: string }>(
        `SELECT ticker || '|' || opened_at AS key FROM ai_positions WHERE user_id = $1`,
        [userId]
      )
    ).rows.map((r) => r.key)
  )

  const alreadyClosed = new Set(
    (
      await pool.query<{ key: string }>(
        `SELECT ticker || '|' || closed_at AS key FROM ai_positions
         WHERE status = 'closed' AND user_id = $1`,
        [userId]
      )
    ).rows.map((r) => r.key)
  )

  let inserted = 0
  for (const t of trades) {
    if (t.action === 'buy') {
      const key = `${t.ticker}|${t.timestamp}`
      if (existing.has(key)) continue
      await openAiPosition(t.ticker, t.quantity, t.estimated_price, t.timestamp, userId)
      existing.add(key)
      inserted++
    } else {
      const closeKey = `${t.ticker}|${t.timestamp}`
      if (alreadyClosed.has(closeKey)) continue
      await closeAiPosition(t.ticker, t.estimated_price, t.timestamp, userId)
      alreadyClosed.add(closeKey)
      inserted++
    }
  }
  return { inserted }
}

// ── Analytics queries ──────────────────────────────────────────────────────

export async function getAllTimeStats(
  userId: string
): Promise<{ totalDecisions: number; totalTrades: number; daysTraded: number }> {
  const pool = getPool()
  const [d, t, s] = await Promise.all([
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM decisions WHERE user_id = $1', [userId]),
    pool.query<{ c: string }>(
      "SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold' AND user_id = $1",
      [userId]
    ),
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM daily_snapshots WHERE user_id = $1', [
      userId,
    ]),
  ])
  return {
    totalDecisions: Number(d.rows[0].c),
    totalTrades: Number(t.rows[0].c),
    daysTraded: Number(s.rows[0].c),
  }
}

export async function getDailyValues(
  userId: string,
  limit = 30
): Promise<Array<{ date: string; value: number }>> {
  const pool = getPool()
  const res = await pool.query<{ date: string; value: number }>(
    `SELECT date,
       COALESCE(ai_close_value, ai_open_value, close_value, open_value) AS value
     FROM daily_snapshots
     WHERE user_id = $1
     ORDER BY date DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows.reverse()
}

export async function getIntradayValues(
  userId: string,
  hours: number
): Promise<Array<{ timestamp: string; value: number }>> {
  const pool = getPool()
  const res = await pool.query<{ timestamp: string; portfolio_json: string }>(
    `SELECT timestamp, portfolio_json
     FROM decisions
     WHERE user_id = $1 AND timestamp::timestamptz >= NOW() - ($2 || ' hours')::interval
     ORDER BY timestamp ASC`,
    [userId, hours]
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

export async function getDecisionsPaginated(
  userId: string,
  page: number,
  limit: number,
  filters: { action?: string; ticker?: string; period?: string } = {}
): Promise<{ data: DecisionRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit

  const conditions: string[] = ['d.user_id = $1']
  const params: unknown[] = [userId]

  if (filters.action) {
    params.push(filters.action)
    conditions.push(`d.action = $${params.length}`)
  }
  if (filters.ticker) {
    params.push(`%${filters.ticker.toUpperCase()}%`)
    conditions.push(`UPPER(d.ticker) LIKE $${params.length}`)
  }
  if (filters.period === 'today') {
    conditions.push(`d.timestamp::date = CURRENT_DATE`)
  } else if (filters.period === 'week') {
    conditions.push(`d.timestamp >= NOW() - INTERVAL '7 days'`)
  } else if (filters.period === 'month') {
    conditions.push(`d.timestamp >= NOW() - INTERVAL '30 days'`)
  }
  const where = `WHERE ${conditions.join(' AND ')}`

  const [countRes, dataRes] = await Promise.all([
    pool.query<{ c: string }>(`SELECT COUNT(*) AS c FROM decisions d ${where}`, params),
    pool.query<{
      id: number
      timestamp: string
      action: string
      ticker: string | null
      quantity: number | null
      estimatedprice: number | null
      reasoning: string
      signalsjson: string
      portfoliojson: string
      orderstatus: string | null
      orderid: string | null
    }>(
      `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
              d.estimated_price AS estimatedprice, d.reasoning,
              d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
              o.status AS orderstatus, o.t212_order_id AS orderid
       FROM decisions d
       LEFT JOIN orders o ON o.decision_id = d.id
       ${where}
       ORDER BY d.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ])
  const total = Number(countRes.rows[0].c)
  const data: DecisionRow[] = dataRes.rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    action: r.action,
    ticker: r.ticker,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    estimatedPrice: r.estimatedprice != null ? Number(r.estimatedprice) : null,
    reasoning: r.reasoning,
    signalsJson: r.signalsjson,
    portfolioJson: r.portfoliojson,
    orderStatus: r.orderstatus,
    orderId: r.orderid,
  }))
  return { data, total }
}

export async function getDecisionById(id: number, userId: string): Promise<DecisionRow | null> {
  const pool = getPool()
  const res = await pool.query<{
    id: number
    timestamp: string
    action: string
    ticker: string | null
    quantity: number | null
    estimatedprice: number | null
    reasoning: string
    signalsjson: string
    portfoliojson: string
    orderstatus: string | null
    orderid: string | null
  }>(
    `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
            d.estimated_price AS estimatedprice, d.reasoning,
            d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
            o.status AS orderstatus, o.t212_order_id AS orderid
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.id = $1 AND d.user_id = $2`,
    [id, userId]
  )
  const r = res.rows[0]
  if (!r) return null
  return {
    id: r.id,
    timestamp: r.timestamp,
    action: r.action,
    ticker: r.ticker,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    estimatedPrice: r.estimatedprice != null ? Number(r.estimatedprice) : null,
    reasoning: r.reasoning,
    signalsJson: r.signalsjson,
    portfolioJson: r.portfoliojson,
    orderStatus: r.orderstatus,
    orderId: r.orderid,
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

export async function getOrdersPaginated(
  userId: string,
  page: number,
  limit: number
): Promise<{ data: OrderRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit
  const [countRes, dataRes] = await Promise.all([
    pool.query<{ c: string }>('SELECT COUNT(*) AS c FROM orders WHERE user_id = $1', [userId]),
    pool.query<{
      id: number
      decisionid: number
      t212orderid: string | null
      status: string
      fillprice: number | null
      fillquantity: number | null
      timestamp: string
      ticker: string | null
      action: string
    }>(
      `SELECT o.id, o.decision_id AS decisionid, o.t212_order_id AS t212orderid,
              o.status, o.fill_price AS fillprice, o.fill_quantity AS fillquantity,
              o.timestamp, d.ticker, d.action
       FROM orders o
       JOIN decisions d ON d.id = o.decision_id
       WHERE o.user_id = $1
       ORDER BY o.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
  ])
  const total = Number(countRes.rows[0].c)
  const data: OrderRow[] = dataRes.rows.map((r) => ({
    id: r.id,
    decisionId: r.decisionid,
    t212OrderId: r.t212orderid,
    status: r.status,
    fillPrice: r.fillprice != null ? Number(r.fillprice) : null,
    fillQuantity: r.fillquantity != null ? Number(r.fillquantity) : null,
    timestamp: r.timestamp,
    ticker: r.ticker,
    action: r.action,
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
  userId: string
}

export async function logAiUsage(record: AiUsageRecord): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO ai_usage
       (decision_id, timestamp, model, input_tokens, output_tokens, input_cost_usd, output_cost_usd, total_cost_usd, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.decisionId,
      record.timestamp,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.inputCostUsd,
      record.outputCostUsd,
      record.totalCostUsd,
      record.userId,
    ]
  )
}

export interface AiUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  callCount: number
  avgCostPerCallUsd: number
}

export async function getAiUsageSummary(userId: string): Promise<AiUsageSummary> {
  const pool = getPool()
  const res = await pool.query<{
    totalinputtokens: string
    totaloutputtokens: string
    totalcostusd: string
    callcount: string
  }>(
    `SELECT
       COALESCE(SUM(input_tokens),    0) AS totalinputtokens,
       COALESCE(SUM(output_tokens),   0) AS totaloutputtokens,
       COALESCE(SUM(total_cost_usd),  0) AS totalcostusd,
       COUNT(*)                          AS callcount
     FROM ai_usage WHERE user_id = $1`,
    [userId]
  )
  const r = res.rows[0]
  const callCount = Number(r.callcount)
  const totalCostUsd = Number(r.totalcostusd)
  return {
    totalInputTokens: Number(r.totalinputtokens),
    totalOutputTokens: Number(r.totaloutputtokens),
    totalCostUsd,
    callCount,
    avgCostPerCallUsd: callCount > 0 ? totalCostUsd / callCount : 0,
  }
}

// ── Legacy CLI helpers ─────────────────────────────────────────────────────

export interface AiTrade {
  action: string
  ticker: string | null
  estimatedValue: number | null
  orderStatus: string | null
  timestamp: string
}

/** Returns all non-hold decisions for a user (legacy dashboard/performance compat). */
export async function getAiTrades(userId: string): Promise<AiTrade[]> {
  const pool = getPool()
  const res = await pool.query<{
    action: string
    ticker: string | null
    estimated_price: number | null
    quantity: number | null
    order_status: string | null
    timestamp: string
  }>(
    `SELECT action, ticker, estimated_price, quantity, order_status, timestamp
     FROM decisions
     WHERE user_id = $1 AND action != 'hold'
     ORDER BY timestamp ASC`,
    [userId]
  )
  return res.rows.map((r) => ({
    action: r.action,
    ticker: r.ticker,
    estimatedValue:
      r.estimated_price != null && r.quantity != null ? r.estimated_price * r.quantity : null,
    orderStatus: r.order_status,
    timestamp: r.timestamp,
  }))
}

/** Net positions view (ticker + net quantity from decisions). Legacy compat. */
export async function getAiNetPositions(
  userId: string
): Promise<Array<{ ticker: string; netQuantity: number }>> {
  const positions = await getOpenAiPositions(userId)
  return positions.map((p) => ({ ticker: p.ticker, netQuantity: p.quantity }))
}

export interface DailyStats {
  date: string
  openValue: number
  closeValue: number | null
  pnl: number | null
  tradesCount: number
}

export async function getDailyStats(date: string, userId?: string): Promise<DailyStats | null> {
  const pool = getPool()
  const params: (string | undefined)[] = [date]
  const userClause = userId ? 'AND user_id = $2' : 'AND user_id IS NULL'
  if (userId) params.push(userId)
  const res = await pool.query<{
    date: string
    open_value: number
    close_value: number | null
  }>(
    `SELECT date, open_value, close_value FROM daily_snapshots WHERE date = $1 ${userClause} LIMIT 1`,
    params
  )
  if (!res.rows[0]) return null
  const row = res.rows[0]
  const tradesRes = await pool.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM decisions WHERE timestamp::date = $1 AND action != 'hold'${userId ? ' AND user_id = $2' : ' AND user_id IS NULL'}`,
    params
  )
  const openValue = Number(row.open_value)
  const closeValue = row.close_value != null ? Number(row.close_value) : null
  return {
    date: row.date,
    openValue,
    closeValue,
    pnl: closeValue != null ? closeValue - openValue : null,
    tradesCount: Number(tradesRes.rows[0].c),
  }
}

export interface OrderForDay {
  action: string | null
  ticker: string | null
  quantity: number | null
  fillPrice: number | null
  status: string | null
  reasoning: string
}

export async function getOrdersForDay(date: string, userId?: string): Promise<OrderForDay[]> {
  const pool = getPool()
  const params: (string | undefined)[] = [date]
  const userClause = userId ? 'AND d.user_id = $2' : 'AND d.user_id IS NULL'
  if (userId) params.push(userId)
  const res = await pool.query<{
    action: string | null
    ticker: string | null
    quantity: number | null
    fill_price: number | null
    status: string | null
    reasoning: string
  }>(
    `SELECT d.action, d.ticker, d.quantity, o.fill_price, o.status, d.reasoning
     FROM decisions d
     LEFT JOIN orders o ON o.decision_id = d.id
     WHERE d.timestamp::date = $1 ${userClause}
     ORDER BY d.timestamp ASC`,
    params
  )
  return res.rows.map((r) => ({
    action: r.action,
    ticker: r.ticker,
    quantity: r.quantity,
    fillPrice: r.fill_price != null ? Number(r.fill_price) : null,
    status: r.status,
    reasoning: r.reasoning,
  }))
}

export async function resetDailySnapshot(date: string, userId?: string): Promise<void> {
  const pool = getPool()
  if (userId) {
    await pool.query('DELETE FROM daily_snapshots WHERE date = $1 AND user_id = $2', [date, userId])
  } else {
    await pool.query('DELETE FROM daily_snapshots WHERE date = $1 AND user_id IS NULL', [date])
  }
}

export async function getDailyStatsRange(
  userId: string,
  limit: number
): Promise<Array<{ date: string; pnl: number | null; tradesCount: number }>> {
  const pool = getPool()
  const res = await pool.query<{ date: string; pnl: string | null; trades_count: string }>(
    `SELECT date, pnl, COALESCE(trades_count, 0) AS trades_count
     FROM daily_snapshots
     WHERE user_id = $1
     ORDER BY date DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows.reverse().map((r) => ({
    date: r.date,
    pnl: r.pnl != null ? Number(Number(r.pnl).toFixed(2)) : null,
    tradesCount: Number(r.trades_count),
  }))
}

export async function getAiUsageByDay(
  userId: string,
  limit = 365
): Promise<Array<{ date: string; costUsd: number; calls: number }>> {
  const pool = getPool()
  const res = await pool.query<{ date: string; costusd: string; calls: string }>(
    `SELECT timestamp::date AS date,
            COALESCE(SUM(total_cost_usd), 0) AS costusd,
            COUNT(*) AS calls
     FROM ai_usage
     WHERE user_id = $1
     GROUP BY timestamp::date
     ORDER BY date DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows.map((r) => ({ date: r.date, costUsd: Number(r.costusd), calls: Number(r.calls) }))
}
