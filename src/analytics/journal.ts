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
  market: string
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
  market: string
}

// ── Decisions ──────────────────────────────────────────────────────────────

export async function logDecision(record: Omit<DecisionRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO decisions (timestamp, action, ticker, quantity, estimated_price, reasoning, signals_json, portfolio_json, user_id, market_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      record.market,
    ]
  )
  return result.rows[0].id
}

// ── Orders ─────────────────────────────────────────────────────────────────

export async function logOrder(record: Omit<OrderRecord, 'id'>): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO orders (decision_id, t212_order_id, status, fill_price, fill_quantity, timestamp, user_id, market_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      record.decisionId,
      record.t212OrderId,
      record.status,
      record.fillPrice,
      record.fillQuantity,
      record.timestamp,
      record.userId,
      record.market,
    ]
  )
  return result.rows[0].id
}

// ── Helper: user-controlled analytics cutoff ───────────────────────────────
// Per-user soft cutoff. UI analytics queries respect it so a user can hide
// pre-reset history from their own view. Trading-logic queries (e.g. circuit
// breaker loss counts, MTD AI cost) must NOT use this — they always see real
// history. Returns the cutoff as an ISO string, or null when unset.
export async function getAnalyticsResetAt(userId: string): Promise<string | null> {
  const pool = getPool()
  const res = await pool.query<{ reset: string | null }>(
    `SELECT analytics_reset_at AS reset FROM users WHERE user_id = $1`,
    [userId]
  )
  const v = res.rows[0]?.reset
  return v ? new Date(v).toISOString() : null
}

export async function setAnalyticsResetAt(userId: string, at: Date | null): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE users SET analytics_reset_at = $1 WHERE user_id = $2`, [at, userId])
}

// ── Daily snapshots ────────────────────────────────────────────────────────

export async function upsertDailySnapshot(
  date: string,
  openValue: number,
  aiOpenValue: number,
  userId: string,
  market: string
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO daily_snapshots (date, open_value, ai_open_value, user_id, market_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, market_code, date) WHERE user_id IS NOT NULL DO NOTHING`,
    [date, openValue, aiOpenValue, userId, market]
  )
}

export async function updateDailyClose(
  date: string,
  closeValue: number,
  pnl: number,
  userId: string,
  market: string,
  aiCloseValue?: number
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold' AND timestamp::date = $1::date AND user_id = $2 AND market_code = $3`,
    [date, userId, market]
  )
  const tradesCount = Number(res.rows[0].c)
  await pool.query(
    `UPDATE daily_snapshots
     SET close_value = $1, pnl = $2, trades_count = $3, ai_close_value = COALESCE($4, ai_close_value)
     WHERE date = $5 AND user_id = $6 AND market_code = $7`,
    [closeValue, pnl, tradesCount, aiCloseValue ?? null, date, userId, market]
  )
}

export async function getDailyOpenValue(
  date: string,
  userId: string,
  market: string
): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ open_value: number }>(
    'SELECT open_value FROM daily_snapshots WHERE date = $1 AND user_id = $2 AND market_code = $3',
    [date, userId, market]
  )
  return res.rows[0]?.open_value ?? null
}

export async function getDailyAiOpenValue(
  date: string,
  userId: string,
  market: string
): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ ai_open_value: number }>(
    'SELECT ai_open_value FROM daily_snapshots WHERE date = $1 AND user_id = $2 AND market_code = $3',
    [date, userId, market]
  )
  return res.rows[0]?.ai_open_value ?? null
}

export async function getPreviousDayAiOpenValue(
  date: string,
  userId: string,
  market: string
): Promise<number | null> {
  const pool = getPool()
  const res = await pool.query<{ ai_open_value: number }>(
    `SELECT ai_open_value FROM daily_snapshots
     WHERE date < $1 AND user_id = $2 AND market_code = $3 AND ai_open_value IS NOT NULL
     ORDER BY date DESC LIMIT 1`,
    [date, userId, market]
  )
  return res.rows[0]?.ai_open_value ?? null
}

export interface RecentDecision {
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  reasoning: string
}

export async function getRecentDecisions(
  userId: string,
  limit = 5,
  market?: string
): Promise<RecentDecision[]> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let where = 'WHERE user_id = $1'
  if (market !== undefined) {
    params.push(market)
    where += ` AND market_code = $${params.length}`
  }
  params.push(limit)
  const res = await pool.query<RecentDecision>(
    `SELECT timestamp, action, ticker, quantity, reasoning FROM decisions ${where} ORDER BY id DESC LIMIT $${params.length}`,
    params
  )
  return res.rows
}

// ── AI Portfolio ───────────────────────────────────────────────────────────
// Note: ai_portfolio_config is user-level, not per-market — kept that way
// because it tracks the user's overall start date and isn't load-bearing.

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
  /** entry_price converted to EUR via the fxRate at fill time. */
  entryPriceEur: number | null
  highWaterMark: number | null
  closedAt: string | null
  exitPrice: number | null
  /** exit_price converted to EUR via the fxRate at fill time. */
  exitPriceEur: number | null
  realizedPnl: number | null
  /** (exit_eur − entry_eur) × quantity. Preferred over realizedPnl for analytics. */
  realizedPnlEur: number | null
  /** Instrument trading currency (USD, EUR, GBX, …). Audit metadata. */
  currencyCode: string | null
  market: string
  status: 'open' | 'closed'
  /** Set when a staged take-profit has fired against this position. */
  partialExitQty: number | null
  partialExitPrice: number | null
  partialExitPriceEur: number | null
  partialExitAt: string | null
}

function mapAiPosition(r: {
  id: number
  ticker: string
  opened_at: string
  quantity: number
  entry_price: number | null
  entry_price_eur?: number | null
  high_water_mark: number | null
  closed_at: string | null
  exit_price: number | null
  exit_price_eur?: number | null
  realized_pnl: number | null
  realized_pnl_eur?: number | null
  currency_code?: string | null
  market_code?: string | null
  status: string
  partial_exit_qty?: number | null
  partial_exit_price?: number | null
  partial_exit_price_eur?: number | null
  partial_exit_at?: string | null
}): AiPosition {
  return {
    id: r.id,
    ticker: r.ticker,
    openedAt: r.opened_at,
    quantity: Number(r.quantity),
    entryPrice: r.entry_price != null ? Number(r.entry_price) : null,
    entryPriceEur: r.entry_price_eur != null ? Number(r.entry_price_eur) : null,
    highWaterMark: r.high_water_mark != null ? Number(r.high_water_mark) : null,
    closedAt: r.closed_at,
    exitPrice: r.exit_price != null ? Number(r.exit_price) : null,
    exitPriceEur: r.exit_price_eur != null ? Number(r.exit_price_eur) : null,
    realizedPnl: r.realized_pnl != null ? Number(r.realized_pnl) : null,
    realizedPnlEur: r.realized_pnl_eur != null ? Number(r.realized_pnl_eur) : null,
    currencyCode: r.currency_code ?? null,
    market: r.market_code ?? 'NYSE',
    status: r.status as 'open' | 'closed',
    partialExitQty: r.partial_exit_qty != null ? Number(r.partial_exit_qty) : null,
    partialExitPrice: r.partial_exit_price != null ? Number(r.partial_exit_price) : null,
    partialExitPriceEur: r.partial_exit_price_eur != null ? Number(r.partial_exit_price_eur) : null,
    partialExitAt: r.partial_exit_at ?? null,
  }
}

export async function openAiPosition(
  ticker: string,
  quantity: number,
  entryPrice: number | null,
  openedAt: string,
  userId: string,
  market: string,
  entryPriceEur: number | null = null,
  currencyCode: string | null = null
): Promise<number> {
  const pool = getPool()
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ai_positions (ticker, opened_at, quantity, entry_price, entry_price_eur, high_water_mark, currency_code, status, user_id, market_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9)
     RETURNING id`,
    [
      ticker,
      openedAt,
      quantity,
      entryPrice,
      entryPriceEur,
      entryPrice,
      currencyCode,
      userId,
      market,
    ]
  )
  return result.rows[0].id
}

export async function updateHighWaterMark(
  ticker: string,
  price: number,
  userId: string,
  market: string
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE ai_positions
     SET high_water_mark = $1
     WHERE ticker = $2 AND status = 'open' AND user_id = $3 AND market_code = $4
       AND (high_water_mark IS NULL OR $1 > high_water_mark)`,
    [price, ticker, userId, market]
  )
}

/**
 * Realized P&L when the position closed in one shot, OR across one partial
 * scale-out followed by a final exit. The DB column `quantity` is always the
 * original opened amount; `partial_exit_qty` captures the chunk sold early.
 */
export function computeStagedPnl(
  entry: number | null,
  exit: number | null,
  qty: number,
  partialQty: number | null,
  partialPrice: number | null
): number | null {
  if (entry == null || exit == null) return null
  if (partialQty != null && partialQty > 0 && partialPrice != null) {
    const remaining = qty - partialQty
    return partialQty * (partialPrice - entry) + remaining * (exit - entry)
  }
  return qty * (exit - entry)
}

export async function closeAiPosition(
  ticker: string,
  exitPrice: number | null,
  closedAt: string,
  userId: string,
  market: string,
  exitPriceEur: number | null = null
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{
    id: number
    quantity: number
    entry_price: number | null
    entry_price_eur: number | null
    partial_exit_qty: number | null
    partial_exit_price: number | null
    partial_exit_price_eur: number | null
  }>(
    `SELECT id, quantity, entry_price, entry_price_eur,
            partial_exit_qty, partial_exit_price, partial_exit_price_eur
       FROM ai_positions
     WHERE ticker = $1 AND status = 'open' AND user_id = $2 AND market_code = $3
     ORDER BY opened_at DESC LIMIT 1`,
    [ticker, userId, market]
  )
  const open = res.rows[0]
  if (!open) return

  const realizedPnl = computeStagedPnl(
    open.entry_price != null ? Number(open.entry_price) : null,
    exitPrice,
    Number(open.quantity),
    open.partial_exit_qty != null ? Number(open.partial_exit_qty) : null,
    open.partial_exit_price != null ? Number(open.partial_exit_price) : null
  )
  const realizedPnlEur = computeStagedPnl(
    open.entry_price_eur != null ? Number(open.entry_price_eur) : null,
    exitPriceEur,
    Number(open.quantity),
    open.partial_exit_qty != null ? Number(open.partial_exit_qty) : null,
    open.partial_exit_price_eur != null ? Number(open.partial_exit_price_eur) : null
  )

  await pool.query(
    `UPDATE ai_positions
     SET status = 'closed', closed_at = $1,
         exit_price = $2, exit_price_eur = $3,
         realized_pnl = $4, realized_pnl_eur = $5
     WHERE id = $6`,
    [closedAt, exitPrice, exitPriceEur, realizedPnl, realizedPnlEur, open.id]
  )
}

export async function closeAllAiPositions(
  ticker: string,
  exitPrice: number | null,
  closedAt: string,
  userId: string,
  market: string,
  exitPriceEur: number | null = null
): Promise<void> {
  const pool = getPool()
  const res = await pool.query<{
    id: number
    quantity: number
    entry_price: number | null
    entry_price_eur: number | null
    partial_exit_qty: number | null
    partial_exit_price: number | null
    partial_exit_price_eur: number | null
  }>(
    `SELECT id, quantity, entry_price, entry_price_eur,
            partial_exit_qty, partial_exit_price, partial_exit_price_eur
       FROM ai_positions
     WHERE ticker = $1 AND status = 'open' AND user_id = $2 AND market_code = $3`,
    [ticker, userId, market]
  )
  for (const open of res.rows) {
    const realizedPnl = computeStagedPnl(
      open.entry_price != null ? Number(open.entry_price) : null,
      exitPrice,
      Number(open.quantity),
      open.partial_exit_qty != null ? Number(open.partial_exit_qty) : null,
      open.partial_exit_price != null ? Number(open.partial_exit_price) : null
    )
    const realizedPnlEur = computeStagedPnl(
      open.entry_price_eur != null ? Number(open.entry_price_eur) : null,
      exitPriceEur,
      Number(open.quantity),
      open.partial_exit_qty != null ? Number(open.partial_exit_qty) : null,
      open.partial_exit_price_eur != null ? Number(open.partial_exit_price_eur) : null
    )
    await pool.query(
      `UPDATE ai_positions
       SET status = 'closed', closed_at = $1,
           exit_price = $2, exit_price_eur = $3,
           realized_pnl = $4, realized_pnl_eur = $5
       WHERE id = $6`,
      [closedAt, exitPrice, exitPriceEur, realizedPnl, realizedPnlEur, open.id]
    )
  }
}

/**
 * Records a staged take-profit fill against an open position. The position
 * stays open (with reduced live quantity at the broker) and the trailing
 * stop on the remainder is tightened by the engine in subsequent cycles.
 *
 * Only the most recently opened row for the ticker is marked, mirroring
 * the close-path's ORDER BY opened_at DESC LIMIT 1 selection.
 */
export async function markPartialExit(
  ticker: string,
  partialQty: number,
  partialPrice: number,
  partialPriceEur: number | null,
  at: string,
  userId: string,
  market: string
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE ai_positions
     SET partial_exit_qty = $1,
         partial_exit_price = $2,
         partial_exit_price_eur = $3,
         partial_exit_at = $4
     WHERE id = (
       SELECT id FROM ai_positions
       WHERE ticker = $5 AND status = 'open' AND user_id = $6 AND market_code = $7
       ORDER BY opened_at DESC LIMIT 1
     )`,
    [partialQty, partialPrice, partialPriceEur, at, ticker, userId, market]
  )
}

export async function updateEntryPrice(
  ticker: string,
  newEntryPrice: number,
  userId: string,
  market: string,
  newEntryPriceEur: number | null = null
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE ai_positions
     SET entry_price = $1,
         entry_price_eur = COALESCE($2, entry_price_eur),
         high_water_mark = CASE WHEN high_water_mark < $1 THEN $1 ELSE high_water_mark END
     WHERE ticker = $3 AND status = 'open' AND user_id = $4 AND market_code = $5`,
    [newEntryPrice, newEntryPriceEur, ticker, userId, market]
  )
}

export async function getOpenAiPositions(userId: string, market?: string): Promise<AiPosition[]> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let sql = `SELECT * FROM ai_positions WHERE status = 'open' AND user_id = $1`
  if (market !== undefined) {
    params.push(market)
    sql += ` AND market_code = $2`
  }
  sql += ` ORDER BY opened_at ASC`
  const res = await pool.query(sql, params)
  return res.rows.map(mapAiPosition)
}

/**
 * Number of losing closed positions for a ticker within the last `days` days.
 * Used by the per-ticker circuit breaker to refuse new entries on tickers that
 * have been consistently bleeding (e.g. FCX took 3 losses worth -$128 before
 * any rule blocked further entries).
 */
export async function getRecentTickerLossCount(
  userId: string,
  ticker: string,
  days: number,
  market?: string
): Promise<number> {
  const pool = getPool()
  const params: unknown[] = [userId, ticker, days]
  let sql = `SELECT COUNT(*) AS c
     FROM ai_positions
     WHERE user_id = $1
       AND ticker = $2
       AND status = 'closed'
       AND realized_pnl IS NOT NULL
       AND realized_pnl < 0
       AND closed_at::timestamptz >= NOW() - ($3 || ' days')::interval`
  if (market !== undefined) {
    params.push(market)
    sql += ` AND market_code = $4`
  }
  const res = await pool.query<{ c: string }>(sql, params)
  return Number(res.rows[0].c)
}

export async function getClosedAiPositions(userId: string, market?: string): Promise<AiPosition[]> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let sql = `SELECT * FROM ai_positions WHERE status = 'closed' AND user_id = $1`
  if (market !== undefined) {
    params.push(market)
    sql += ` AND market_code = $${params.length}`
  }
  const reset = await getAnalyticsResetAt(userId)
  if (reset) {
    params.push(reset)
    sql += ` AND closed_at >= $${params.length}`
  }
  sql += ` ORDER BY closed_at DESC`
  const res = await pool.query(sql, params)
  return res.rows.map(mapAiPosition)
}

export interface AiPositionWithOrders extends AiPosition {
  buyT212OrderId: string | null
  sellT212OrderId: string | null
}

export interface PositionDecisionDetail {
  timestamp: string
  reasoning: string
  signalsJson: string
  orderStatus: string | null
}

export interface AiPositionDetails {
  buyDecision: PositionDecisionDetail | null
  sellDecision: PositionDecisionDetail | null
}

export async function getAiPositionDetails(
  id: number,
  userId: string
): Promise<AiPositionDetails | null> {
  const pool = getPool()
  const res = await pool.query<{
    opened_at: string
    closed_at: string | null
    buy_reasoning: string | null
    buy_signals_json: string | null
    buy_order_status: string | null
    sell_reasoning: string | null
    sell_signals_json: string | null
    sell_order_status: string | null
  }>(
    `SELECT
       ap.opened_at, ap.closed_at,
       buy_d.reasoning     AS buy_reasoning,
       buy_d.signals_json  AS buy_signals_json,
       buy_o.status        AS buy_order_status,
       sell_d.reasoning    AS sell_reasoning,
       sell_d.signals_json AS sell_signals_json,
       sell_o.status       AS sell_order_status
     FROM ai_positions ap
     LEFT JOIN decisions buy_d
       ON  buy_d.ticker    = ap.ticker
       AND buy_d.action    = 'buy'
       AND buy_d.timestamp = ap.opened_at
       AND buy_d.user_id   = ap.user_id
     LEFT JOIN orders buy_o ON buy_o.decision_id = buy_d.id
     LEFT JOIN decisions sell_d
       ON  sell_d.ticker    = ap.ticker
       AND sell_d.action    = 'sell'
       AND sell_d.timestamp = ap.closed_at
       AND sell_d.user_id   = ap.user_id
     LEFT JOIN orders sell_o ON sell_o.decision_id = sell_d.id
     WHERE ap.id = $1 AND ap.user_id = $2`,
    [id, userId]
  )
  const r = res.rows[0]
  if (!r) return null
  return {
    buyDecision:
      r.buy_reasoning != null
        ? {
            timestamp: r.opened_at,
            reasoning: r.buy_reasoning,
            signalsJson: r.buy_signals_json ?? '[]',
            orderStatus: r.buy_order_status,
          }
        : null,
    sellDecision:
      r.sell_reasoning != null
        ? {
            timestamp: r.closed_at ?? '',
            reasoning: r.sell_reasoning,
            signalsJson: r.sell_signals_json ?? '[]',
            orderStatus: r.sell_order_status,
          }
        : null,
  }
}

export async function getClosedAiPositionsWithOrders(
  userId: string,
  from?: string,
  to?: string,
  market?: string
): Promise<AiPositionWithOrders[]> {
  const pool = getPool()
  const conditions = ["ap.status = 'closed'", 'ap.user_id = $1']
  const params: unknown[] = [userId]

  if (from) {
    params.push(from)
    conditions.push(`ap.closed_at >= $${params.length}`)
  }
  if (to) {
    params.push(`${to}T23:59:59.999`)
    conditions.push(`ap.closed_at <= $${params.length}`)
  }
  if (market !== undefined) {
    params.push(market)
    conditions.push(`ap.market_code = $${params.length}`)
  }
  const reset = await getAnalyticsResetAt(userId)
  if (reset) {
    params.push(reset)
    conditions.push(`ap.closed_at >= $${params.length}`)
  }

  const res = await pool.query(
    `SELECT
       ap.id, ap.ticker, ap.opened_at, ap.closed_at, ap.quantity,
       ap.entry_price, ap.entry_price_eur,
       ap.high_water_mark,
       ap.exit_price, ap.exit_price_eur,
       ap.realized_pnl, ap.realized_pnl_eur,
       ap.currency_code, ap.market_code, ap.status,
       ap.partial_exit_qty, ap.partial_exit_price,
       ap.partial_exit_price_eur, ap.partial_exit_at,
       buy_o.t212_order_id  AS buy_t212_id,
       sell_o.t212_order_id AS sell_t212_id
     FROM ai_positions ap
     LEFT JOIN decisions buy_d
       ON  buy_d.ticker    = ap.ticker
       AND buy_d.action    = 'buy'
       AND buy_d.timestamp = ap.opened_at
       AND buy_d.user_id   = ap.user_id
     LEFT JOIN orders buy_o ON buy_o.decision_id = buy_d.id
     LEFT JOIN decisions sell_d
       ON  sell_d.ticker    = ap.ticker
       AND sell_d.action    = 'sell'
       AND sell_d.timestamp = ap.closed_at
       AND sell_d.user_id   = ap.user_id
     LEFT JOIN orders sell_o ON sell_o.decision_id = sell_d.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ap.closed_at DESC`,
    params
  )

  return res.rows.map((r) => ({
    ...mapAiPosition({
      id: r.id,
      ticker: r.ticker,
      opened_at: r.opened_at,
      quantity: r.quantity,
      entry_price: r.entry_price,
      entry_price_eur: r.entry_price_eur,
      high_water_mark: r.high_water_mark,
      closed_at: r.closed_at,
      exit_price: r.exit_price,
      exit_price_eur: r.exit_price_eur,
      realized_pnl: r.realized_pnl,
      realized_pnl_eur: r.realized_pnl_eur,
      currency_code: r.currency_code,
      market_code: r.market_code,
      status: r.status,
      partial_exit_qty: r.partial_exit_qty,
      partial_exit_price: r.partial_exit_price,
      partial_exit_price_eur: r.partial_exit_price_eur,
      partial_exit_at: r.partial_exit_at,
    }),
    buyT212OrderId: r.buy_t212_id ?? null,
    sellT212OrderId: r.sell_t212_id ?? null,
  }))
}

export async function reconcileAiPositions(
  userId: string,
  market: string
): Promise<{ inserted: number }> {
  const pool = getPool()

  // Only reconcile decisions that actually placed an order at T212. Without
  // this filter, any buy/sell decision that the engine logged but then aborted
  // (gap guard, pre-order error before logOrder ran, etc.) would produce a
  // phantom position with fabricated entry/exit and realised P&L.
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
       JOIN orders o ON o.decision_id = d.id
       WHERE d.action IN ('buy', 'sell')
         AND d.ticker IS NOT NULL
         AND d.user_id = $1
         AND d.market_code = $2
         AND o.status NOT LIKE 'blocked%'
         AND o.status NOT LIKE 'error%'
       ORDER BY d.id ASC`,
      [userId, market]
    )
  ).rows

  const existing = new Set(
    (
      await pool.query<{ key: string }>(
        `SELECT ticker || '|' || opened_at AS key FROM ai_positions WHERE user_id = $1 AND market_code = $2`,
        [userId, market]
      )
    ).rows.map((r) => r.key)
  )

  const alreadyClosed = new Set(
    (
      await pool.query<{ key: string }>(
        `SELECT ticker || '|' || closed_at AS key FROM ai_positions
         WHERE status = 'closed' AND user_id = $1 AND market_code = $2`,
        [userId, market]
      )
    ).rows.map((r) => r.key)
  )

  let inserted = 0
  for (const t of trades) {
    if (t.action === 'buy') {
      const key = `${t.ticker}|${t.timestamp}`
      if (existing.has(key)) continue
      await openAiPosition(t.ticker, t.quantity, t.estimated_price, t.timestamp, userId, market)
      existing.add(key)
      inserted++
    } else {
      const closeKey = `${t.ticker}|${t.timestamp}`
      if (alreadyClosed.has(closeKey)) continue
      await closeAiPosition(t.ticker, t.estimated_price, t.timestamp, userId, market)
      alreadyClosed.add(closeKey)
      inserted++
    }
  }
  return { inserted }
}

// ── Analytics queries ──────────────────────────────────────────────────────

export async function getAllTimeStats(
  userId: string,
  market?: string
): Promise<{ totalDecisions: number; totalTrades: number; daysTraded: number }> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let mc = ''
  if (market !== undefined) {
    params.push(market)
    mc = ` AND market_code = $${params.length}`
  }
  const reset = await getAnalyticsResetAt(userId)
  let tsClause = ''
  let dateClause = ''
  if (reset) {
    params.push(reset)
    tsClause = ` AND timestamp >= $${params.length}`
    dateClause = ` AND date >= ($${params.length})::date`
  }
  const [d, t, s] = await Promise.all([
    pool.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM decisions WHERE user_id = $1${mc}${tsClause}`,
      params
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM decisions WHERE action != 'hold' AND user_id = $1${mc}${tsClause}`,
      params
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*) AS c FROM daily_snapshots WHERE user_id = $1${mc}${dateClause}`,
      params
    ),
  ])
  return {
    totalDecisions: Number(d.rows[0].c),
    totalTrades: Number(t.rows[0].c),
    daysTraded: Number(s.rows[0].c),
  }
}

export async function getDailyValues(
  userId: string,
  limit = 30,
  market?: string
): Promise<Array<{ date: string; value: number }>> {
  const pool = getPool()
  const reset = await getAnalyticsResetAt(userId)
  // When market is omitted, sum per date across all markets so the equity
  // curve shows the combined EUR value the user holds.
  if (market === undefined) {
    const params: unknown[] = [userId]
    let resetClause = ''
    if (reset) {
      params.push(reset)
      resetClause = ` AND date >= ($${params.length})::date`
    }
    params.push(limit)
    const res = await pool.query<{ date: string; value: number }>(
      `SELECT date,
         SUM(COALESCE(ai_close_value, ai_open_value, close_value, open_value)) AS value
       FROM daily_snapshots
       WHERE user_id = $1${resetClause}
       GROUP BY date
       ORDER BY date DESC
       LIMIT $${params.length}`,
      params
    )
    return res.rows.reverse().map((r) => ({ date: r.date, value: Number(r.value) }))
  }
  const params: unknown[] = [userId, market]
  let resetClause = ''
  if (reset) {
    params.push(reset)
    resetClause = ` AND date >= ($${params.length})::date`
  }
  params.push(limit)
  const res = await pool.query<{ date: string; value: number }>(
    `SELECT date,
       COALESCE(ai_close_value, ai_open_value, close_value, open_value) AS value
     FROM daily_snapshots
     WHERE user_id = $1 AND market_code = $2${resetClause}
     ORDER BY date DESC
     LIMIT $${params.length}`,
    params
  )
  return res.rows.reverse().map((r) => ({ date: r.date, value: Number(r.value) }))
}

export async function getIntradayValues(
  userId: string,
  hours: number,
  market?: string
): Promise<Array<{ timestamp: string; value: number }>> {
  const pool = getPool()
  const params: unknown[] = [userId, hours]
  let mc = ''
  if (market !== undefined) {
    params.push(market)
    mc = ` AND market_code = $${params.length}`
  }
  const reset = await getAnalyticsResetAt(userId)
  let resetClause = ''
  if (reset) {
    params.push(reset)
    resetClause = ` AND timestamp >= $${params.length}`
  }
  const res = await pool.query<{ timestamp: string; portfolio_json: string }>(
    `SELECT timestamp, portfolio_json
     FROM decisions
     WHERE user_id = $1 AND timestamp::timestamptz >= NOW() - ($2 || ' hours')::interval${mc}${resetClause}
     ORDER BY timestamp ASC`,
    params
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
  market: string
}

export async function getDecisionsPaginated(
  userId: string,
  page: number,
  limit: number,
  filters: { action?: string; ticker?: string; period?: string; market?: string } = {}
): Promise<{ data: DecisionRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit

  const conditions: string[] = ['d.user_id = $1']
  const params: unknown[] = [userId]

  if (filters.market) {
    params.push(filters.market)
    conditions.push(`d.market_code = $${params.length}`)
  }
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
      marketcode: string
    }>(
      `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
              d.estimated_price AS estimatedprice, d.reasoning,
              d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
              o.status AS orderstatus, o.t212_order_id AS orderid,
              d.market_code AS marketcode
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
    market: r.marketcode,
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
    marketcode: string
  }>(
    `SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity,
            d.estimated_price AS estimatedprice, d.reasoning,
            d.signals_json AS signalsjson, d.portfolio_json AS portfoliojson,
            o.status AS orderstatus, o.t212_order_id AS orderid,
            d.market_code AS marketcode
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
    market: r.marketcode,
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
  market: string
}

export async function getOrdersPaginated(
  userId: string,
  page: number,
  limit: number,
  market?: string
): Promise<{ data: OrderRow[]; total: number }> {
  const pool = getPool()
  const offset = (page - 1) * limit
  const params: unknown[] = [userId]
  let where = `WHERE o.user_id = $1`
  if (market !== undefined) {
    params.push(market)
    where += ` AND o.market_code = $${params.length}`
  }
  const [countRes, dataRes] = await Promise.all([
    pool.query<{ c: string }>(`SELECT COUNT(*) AS c FROM orders o ${where}`, params),
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
      marketcode: string
    }>(
      `SELECT o.id, o.decision_id AS decisionid, o.t212_order_id AS t212orderid,
              o.status, o.fill_price AS fillprice, o.fill_quantity AS fillquantity,
              o.timestamp, d.ticker, d.action, o.market_code AS marketcode
       FROM orders o
       JOIN decisions d ON d.id = o.decision_id
       ${where}
       ORDER BY o.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
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
    market: r.marketcode,
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
  market: string
}

export async function logAiUsage(record: AiUsageRecord): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO ai_usage
       (decision_id, timestamp, model, input_tokens, output_tokens, input_cost_usd, output_cost_usd, total_cost_usd, user_id, market_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      record.market,
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

export async function getAiUsageSummary(userId: string, market?: string): Promise<AiUsageSummary> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let mc = ''
  if (market !== undefined) {
    params.push(market)
    mc = ` AND market_code = $${params.length}`
  }
  const reset = await getAnalyticsResetAt(userId)
  let resetClause = ''
  if (reset) {
    params.push(reset)
    resetClause = ` AND timestamp >= $${params.length}`
  }
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
     FROM ai_usage WHERE user_id = $1${mc}${resetClause}`,
    params
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

/**
 * Sum of `ai_usage.total_cost_usd` for the current calendar month (UTC).
 * Used by the `ai_with_fallback` decision mode to trip the deterministic
 * fallback when monthly Anthropic spend reaches the user's configured cap.
 */
export async function getMonthToDateAiCostUsd(
  userId: string,
  market: string,
  now: Date = new Date()
): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const pool = getPool()
  const res = await pool.query<{ cost: string }>(
    `SELECT COALESCE(SUM(total_cost_usd), 0) AS cost
     FROM ai_usage
     WHERE user_id = $1 AND market_code = $2 AND timestamp >= $3`,
    [userId, market, monthStart.toISOString()]
  )
  return Number(res.rows[0]?.cost ?? 0)
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
export async function getAiTrades(userId: string, market?: string): Promise<AiTrade[]> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let mc = ''
  if (market !== undefined) {
    params.push(market)
    mc = ' AND market_code = $2'
  }
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
     WHERE user_id = $1 AND action != 'hold'${mc}
     ORDER BY timestamp ASC`,
    params
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
  userId: string,
  market?: string
): Promise<Array<{ ticker: string; netQuantity: number }>> {
  const positions = await getOpenAiPositions(userId, market)
  return positions.map((p) => ({ ticker: p.ticker, netQuantity: p.quantity }))
}

export interface DailyStats {
  date: string
  openValue: number
  closeValue: number | null
  pnl: number | null
  tradesCount: number
}

export async function getDailyStats(
  date: string,
  userId?: string,
  market?: string
): Promise<DailyStats | null> {
  const pool = getPool()
  const params: (string | undefined)[] = [date]
  const userClause = userId ? 'AND user_id = $2' : 'AND user_id IS NULL'
  if (userId) params.push(userId)
  let mc = ''
  if (userId && market !== undefined) {
    params.push(market)
    mc = ` AND market_code = $${params.length}`
  }
  const res = await pool.query<{
    date: string
    open_value: number
    close_value: number | null
  }>(
    `SELECT date, open_value, close_value FROM daily_snapshots WHERE date = $1 ${userClause}${mc} LIMIT 1`,
    params
  )
  if (!res.rows[0]) return null
  const row = res.rows[0]
  const tradeParams: (string | undefined)[] = [date]
  if (userId) tradeParams.push(userId)
  let tradeMc = ''
  if (userId && market !== undefined) {
    tradeParams.push(market)
    tradeMc = ` AND market_code = $${tradeParams.length}`
  }
  const tradesRes = await pool.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM decisions WHERE timestamp::date = $1 AND action != 'hold'${userId ? ' AND user_id = $2' : ' AND user_id IS NULL'}${tradeMc}`,
    tradeParams
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

export async function getOrdersForDay(
  date: string,
  userId?: string,
  market?: string
): Promise<OrderForDay[]> {
  const pool = getPool()
  const params: (string | undefined)[] = [date]
  const userClause = userId ? 'AND d.user_id = $2' : 'AND d.user_id IS NULL'
  if (userId) params.push(userId)
  let mc = ''
  if (userId && market !== undefined) {
    params.push(market)
    mc = ` AND d.market_code = $${params.length}`
  }
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
     WHERE d.timestamp::date = $1 ${userClause}${mc}
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

export async function resetDailySnapshot(
  date: string,
  userId?: string,
  market?: string
): Promise<void> {
  const pool = getPool()
  if (userId) {
    if (market !== undefined) {
      await pool.query(
        'DELETE FROM daily_snapshots WHERE date = $1 AND user_id = $2 AND market_code = $3',
        [date, userId, market]
      )
    } else {
      await pool.query('DELETE FROM daily_snapshots WHERE date = $1 AND user_id = $2', [
        date,
        userId,
      ])
    }
  } else {
    await pool.query('DELETE FROM daily_snapshots WHERE date = $1 AND user_id IS NULL', [date])
  }
}

export async function getDailyStatsRange(
  userId: string,
  limit: number,
  market?: string
): Promise<Array<{ date: string; pnl: number | null; tradesCount: number }>> {
  const pool = getPool()
  const reset = await getAnalyticsResetAt(userId)
  if (market === undefined) {
    const params: unknown[] = [userId]
    let resetClause = ''
    if (reset) {
      params.push(reset)
      resetClause = ` AND date >= ($${params.length})::date`
    }
    params.push(limit)
    // Aggregate per date across all markets
    const res = await pool.query<{ date: string; pnl: string | null; trades_count: string }>(
      `SELECT date,
              SUM(pnl)::numeric AS pnl,
              SUM(COALESCE(trades_count, 0))::numeric AS trades_count
       FROM daily_snapshots
       WHERE user_id = $1${resetClause}
       GROUP BY date
       ORDER BY date DESC
       LIMIT $${params.length}`,
      params
    )
    return res.rows.reverse().map((r) => ({
      date: r.date,
      pnl: r.pnl != null ? Number(Number(r.pnl).toFixed(2)) : null,
      tradesCount: Number(r.trades_count),
    }))
  }
  const params: unknown[] = [userId, market]
  let resetClause = ''
  if (reset) {
    params.push(reset)
    resetClause = ` AND date >= ($${params.length})::date`
  }
  params.push(limit)
  const res = await pool.query<{ date: string; pnl: string | null; trades_count: string }>(
    `SELECT date, pnl, COALESCE(trades_count, 0) AS trades_count
     FROM daily_snapshots
     WHERE user_id = $1 AND market_code = $2${resetClause}
     ORDER BY date DESC
     LIMIT $${params.length}`,
    params
  )
  return res.rows.reverse().map((r) => ({
    date: r.date,
    pnl: r.pnl != null ? Number(Number(r.pnl).toFixed(2)) : null,
    tradesCount: Number(r.trades_count),
  }))
}

export async function getAiUsageByDay(
  userId: string,
  limit = 365,
  market?: string
): Promise<Array<{ date: string; costUsd: number; calls: number }>> {
  const pool = getPool()
  const params: unknown[] = [userId]
  let mc = ''
  if (market !== undefined) {
    params.push(market)
    mc = ` AND market_code = $${params.length}`
  }
  const reset = await getAnalyticsResetAt(userId)
  let resetClause = ''
  if (reset) {
    params.push(reset)
    resetClause = ` AND timestamp >= $${params.length}`
  }
  params.push(limit)
  const res = await pool.query<{ date: string; costusd: string; calls: string }>(
    `SELECT timestamp::date AS date,
            COALESCE(SUM(total_cost_usd), 0) AS costusd,
            COUNT(*) AS calls
     FROM ai_usage
     WHERE user_id = $1${mc}${resetClause}
     GROUP BY timestamp::date
     ORDER BY date DESC
     LIMIT $${params.length}`,
    params
  )
  return res.rows.map((r) => ({ date: r.date, costUsd: Number(r.costusd), calls: Number(r.calls) }))
}
