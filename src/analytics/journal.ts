import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { config } from '../config/index.js'
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

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  mkdirSync(dirname(config.dbPath), { recursive: true })
  _db = new Database(config.dbPath)
  _db.pragma('journal_mode = WAL')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      ticker TEXT,
      quantity REAL,
      estimated_price REAL,
      reasoning TEXT NOT NULL,
      signals_json TEXT NOT NULL,
      portfolio_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER REFERENCES decisions(id),
      t212_order_id TEXT,
      status TEXT NOT NULL,
      fill_price REAL,
      fill_quantity REAL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_snapshots (
      date TEXT PRIMARY KEY,
      open_value REAL NOT NULL,
      close_value REAL,
      trades_count INTEGER DEFAULT 0,
      pnl REAL
    );

    CREATE TABLE IF NOT EXISTS ai_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL,
      closed_at TEXT,
      exit_price REAL,
      realized_pnl REAL,
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER REFERENCES decisions(id),
      timestamp TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      input_cost_usd REAL NOT NULL,
      output_cost_usd REAL NOT NULL,
      total_cost_usd REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_portfolio_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TEXT NOT NULL,
      initial_budget REAL NOT NULL
    );
  `)

  // Safe migrations
  try { _db.exec(`ALTER TABLE decisions ADD COLUMN estimated_price REAL`) } catch {}
  try { _db.exec(`ALTER TABLE ai_positions ADD COLUMN high_water_mark REAL`) } catch {}
  try { _db.exec(`ALTER TABLE daily_snapshots ADD COLUMN ai_open_value REAL`) } catch {}
  try { _db.exec(`ALTER TABLE daily_snapshots ADD COLUMN ai_close_value REAL`) } catch {}
  return _db
}

export function logDecision(record: Omit<DecisionRecord, 'id'>): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO decisions (timestamp, action, ticker, quantity, estimated_price, reasoning, signals_json, portfolio_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    record.timestamp,
    record.action,
    record.ticker,
    record.quantity,
    record.estimatedPrice,
    record.reasoning,
    record.signalsJson,
    record.portfolioJson,
  )
  return result.lastInsertRowid as number
}

export function logOrder(record: Omit<OrderRecord, 'id'>): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO orders (decision_id, t212_order_id, status, fill_price, fill_quantity, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    record.decisionId,
    record.t212OrderId,
    record.status,
    record.fillPrice,
    record.fillQuantity,
    record.timestamp,
  )
  return result.lastInsertRowid as number
}

export function upsertDailySnapshot(date: string, openValue: number, aiOpenValue: number): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO daily_snapshots (date, open_value, ai_open_value) VALUES (?, ?, ?)
    ON CONFLICT(date) DO NOTHING
  `).run(date, openValue, aiOpenValue)
}

export function updateDailyClose(date: string, closeValue: number, pnl: number, aiCloseValue?: number): void {
  const db = getDb()
  const tradesCount = (
    db.prepare(`SELECT COUNT(*) as c FROM decisions WHERE action != 'hold' AND date(timestamp) = ?`).get(date) as { c: number }
  ).c
  db.prepare(`
    UPDATE daily_snapshots SET close_value = ?, pnl = ?, trades_count = ?, ai_close_value = COALESCE(?, ai_close_value) WHERE date = ?
  `).run(closeValue, pnl, tradesCount, aiCloseValue ?? null, date)
}

export function resetDailySnapshot(date: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM daily_snapshots WHERE date = ?`).run(date)
}

export function getDailyOpenValue(date: string): number | null {
  const db = getDb()
  const row = db.prepare(`SELECT open_value FROM daily_snapshots WHERE date = ?`).get(date) as
    | { open_value: number }
    | undefined
  return row?.open_value ?? null
}

export interface RecentDecision {
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  reasoning: string
}

export function getRecentDecisions(limit = 5): RecentDecision[] {
  const db = getDb()
  return db
    .prepare(`SELECT timestamp, action, ticker, quantity, reasoning FROM decisions ORDER BY id DESC LIMIT ?`)
    .all(limit) as RecentDecision[]
}

export interface DailyStats {
  date: string
  openValue: number
  closeValue: number | null
  tradesCount: number
  pnl: number | null
}

export function getDailyStats(date: string): DailyStats | null {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM daily_snapshots WHERE date = ?`).get(date) as
    | { date: string; open_value: number; close_value: number | null; trades_count: number; pnl: number | null }
    | undefined
  if (!row) return null
  return {
    date: row.date,
    openValue: row.open_value,
    closeValue: row.close_value,
    tradesCount: row.trades_count,
    pnl: row.pnl,
  }
}

export function getDailyValues(limit = 30): Array<{ date: string; value: number }> {
  const db = getDb()
  return (
    db
      .prepare(
        `SELECT date,
           COALESCE(ai_close_value, ai_open_value, close_value, open_value) as value
         FROM daily_snapshots ORDER BY date DESC LIMIT ?`
      )
      .all(limit) as Array<{ date: string; value: number }>
  ).reverse()
}

export function getAllTimeStats(): {
  totalDecisions: number
  totalTrades: number
  daysTraded: number
} {
  const db = getDb()
  const totalDecisions = (db.prepare(`SELECT COUNT(*) as c FROM decisions`).get() as { c: number }).c
  const totalTrades = (
    db.prepare(`SELECT COUNT(*) as c FROM decisions WHERE action != 'hold'`).get() as { c: number }
  ).c
  const daysTraded = (db.prepare(`SELECT COUNT(*) as c FROM daily_snapshots`).get() as { c: number }).c
  return { totalDecisions, totalTrades, daysTraded }
}

// ── AI Portfolio ───────────────────────────────────────────────────────────

export interface AiPortfolioConfig {
  startedAt: string
  initialBudget: number
}

export function initAiPortfolio(initialBudget: number): void {
  const db = getDb()
  db.prepare(`INSERT OR REPLACE INTO ai_portfolio_config (id, started_at, initial_budget) VALUES (1, ?, ?)`)
    .run(new Date().toISOString(), initialBudget)
}

export function getAiPortfolioConfig(): AiPortfolioConfig | null {
  const db = getDb()
  const row = db.prepare(`SELECT started_at, initial_budget FROM ai_portfolio_config WHERE id = 1`).get() as
    | { started_at: string; initial_budget: number }
    | undefined
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

export function getAiTrades(): AiTrade[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price as estimatedPrice,
           o.status as orderStatus
    FROM decisions d
    LEFT JOIN orders o ON o.decision_id = d.id
    WHERE d.action IN ('buy', 'sell') AND d.ticker IS NOT NULL
    ORDER BY d.id ASC
  `).all() as Array<{
    timestamp: string; action: 'buy' | 'sell'; ticker: string
    quantity: number; estimatedPrice: number | null; orderStatus: string | null
  }>
  return rows.map(r => ({
    ...r,
    estimatedValue: r.estimatedPrice != null ? r.estimatedPrice * r.quantity : null,
  }))
}

export interface AiNetPosition {
  ticker: string
  netQuantity: number
}

export function getAiNetPositions(): AiNetPosition[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT d.ticker,
           SUM(CASE WHEN d.action = 'buy' THEN d.quantity ELSE -d.quantity END) as net_quantity
    FROM decisions d
    LEFT JOIN orders o ON o.decision_id = d.id
    WHERE d.action IN ('buy', 'sell')
      AND d.ticker IS NOT NULL
      AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
    GROUP BY d.ticker
    HAVING net_quantity > 0
  `).all() as Array<{ ticker: string; net_quantity: number }>
  return rows.map(r => ({ ticker: r.ticker, netQuantity: r.net_quantity }))
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

export function openAiPosition(ticker: string, quantity: number, entryPrice: number | null, openedAt: string): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO ai_positions (ticker, opened_at, quantity, entry_price, high_water_mark, status)
    VALUES (?, ?, ?, ?, ?, 'open')
  `).run(ticker, openedAt, quantity, entryPrice, entryPrice)
  return result.lastInsertRowid as number
}

export function updateHighWaterMark(ticker: string, price: number): void {
  const db = getDb()
  db.prepare(`
    UPDATE ai_positions SET high_water_mark = ?
    WHERE ticker = ? AND status = 'open'
      AND (high_water_mark IS NULL OR ? > high_water_mark)
  `).run(price, ticker, price)
}

export function getHighWaterMark(ticker: string): number | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT high_water_mark FROM ai_positions WHERE ticker = ? AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1
  `).get(ticker) as { high_water_mark: number | null } | undefined
  return row?.high_water_mark ?? null
}

export function closeAiPosition(ticker: string, exitPrice: number | null, closedAt: string): void {
  const db = getDb()
  // Close the most recently opened position for this ticker
  const open = db.prepare(`
    SELECT id, quantity, entry_price FROM ai_positions
    WHERE ticker = ? AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1
  `).get(ticker) as { id: number; quantity: number; entry_price: number | null } | undefined
  if (!open) return

  const realizedPnl =
    exitPrice != null && open.entry_price != null
      ? (exitPrice - open.entry_price) * open.quantity
      : null

  db.prepare(`
    UPDATE ai_positions SET status = 'closed', closed_at = ?, exit_price = ?, realized_pnl = ?
    WHERE id = ?
  `).run(closedAt, exitPrice, realizedPnl, open.id)
}

export function getOpenAiPositions(): AiPosition[] {
  const db = getDb()
  return (db.prepare(`SELECT * FROM ai_positions WHERE status = 'open' ORDER BY opened_at ASC`).all() as Array<{
    id: number; ticker: string; opened_at: string; quantity: number; entry_price: number | null
    high_water_mark: number | null; closed_at: string | null; exit_price: number | null
    realized_pnl: number | null; status: string
  }>).map(r => ({
    id: r.id, ticker: r.ticker, openedAt: r.opened_at, quantity: r.quantity,
    entryPrice: r.entry_price, highWaterMark: r.high_water_mark,
    closedAt: r.closed_at, exitPrice: r.exit_price,
    realizedPnl: r.realized_pnl, status: r.status as 'open' | 'closed',
  }))
}

// Reconciles ai_positions from the decisions+orders tables.
// Safe to call at startup — skips entries already recorded.
// This self-heals after crashes or any gap between order placement and position recording.
export function reconcileAiPositions(): { inserted: number } {
  const db = getDb()

  const trades = db.prepare(`
    SELECT d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price
    FROM decisions d
    LEFT JOIN orders o ON o.decision_id = d.id
    WHERE d.action IN ('buy', 'sell')
      AND d.ticker IS NOT NULL
      AND (o.status IS NULL OR (o.status NOT LIKE 'blocked%' AND o.status NOT LIKE 'error%'))
    ORDER BY d.id ASC
  `).all() as Array<{
    timestamp: string
    action: 'buy' | 'sell'
    ticker: string
    quantity: number
    estimated_price: number | null
  }>

  const existing = new Set(
    (db.prepare(`SELECT ticker || '|' || opened_at as key FROM ai_positions`).all() as Array<{ key: string }>)
      .map((r) => r.key)
  )

  let inserted = 0
  for (const t of trades) {
    if (t.action === 'buy') {
      const key = `${t.ticker}|${t.timestamp}`
      if (existing.has(key)) continue
      openAiPosition(t.ticker, t.quantity, t.estimated_price, t.timestamp)
      existing.add(key)
      inserted++
    } else {
      closeAiPosition(t.ticker, t.estimated_price, t.timestamp)
      inserted++
    }
  }
  return { inserted }
}

export function getClosedAiPositions(): AiPosition[] {
  const db = getDb()
  return (db.prepare(`SELECT * FROM ai_positions WHERE status = 'closed' ORDER BY closed_at DESC`).all() as Array<{
    id: number; ticker: string; opened_at: string; quantity: number; entry_price: number | null
    high_water_mark: number | null; closed_at: string | null; exit_price: number | null
    realized_pnl: number | null; status: string
  }>).map(r => ({
    id: r.id, ticker: r.ticker, openedAt: r.opened_at, quantity: r.quantity,
    entryPrice: r.entry_price, highWaterMark: r.high_water_mark,
    closedAt: r.closed_at, exitPrice: r.exit_price,
    realizedPnl: r.realized_pnl, status: r.status as 'open' | 'closed',
  }))
}

// ── Paginated API queries ─────────────────────────────────────────────────

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

export function logAiUsage(record: AiUsageRecord): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO ai_usage (decision_id, timestamp, model, input_tokens, output_tokens, input_cost_usd, output_cost_usd, total_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.decisionId, record.timestamp, record.model,
    record.inputTokens, record.outputTokens,
    record.inputCostUsd, record.outputCostUsd, record.totalCostUsd,
  )
}

export interface AiUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  callCount: number
  avgCostPerCallUsd: number
}

export function getAiUsageSummary(): AiUsageSummary {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0)   AS totalInputTokens,
      COALESCE(SUM(output_tokens), 0)  AS totalOutputTokens,
      COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd,
      COUNT(*)                          AS callCount
    FROM ai_usage
  `).get() as { totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number; callCount: number }
  return {
    ...row,
    avgCostPerCallUsd: row.callCount > 0 ? row.totalCostUsd / row.callCount : 0,
  }
}

export function getAiUsageByDay(limit = 30): Array<{ date: string; costUsd: number; calls: number }> {
  const db = getDb()
  return db.prepare(`
    SELECT date(timestamp) AS date,
           COALESCE(SUM(total_cost_usd), 0) AS costUsd,
           COUNT(*) AS calls
    FROM ai_usage
    GROUP BY date(timestamp)
    ORDER BY date DESC
    LIMIT ?
  `).all(limit) as Array<{ date: string; costUsd: number; calls: number }>
}

export function getIntradayValues(hours: number): Array<{ timestamp: string; value: number }> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT timestamp, portfolio_json
    FROM decisions
    WHERE timestamp >= datetime('now', ? )
    ORDER BY timestamp ASC
  `).all(`-${hours} hours`) as Array<{ timestamp: string; portfolio_json: string }>

  return rows.flatMap((r) => {
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

export function getDecisionsPaginated(page: number, limit: number): { data: DecisionRow[]; total: number } {
  const db = getDb()
  const offset = (page - 1) * limit
  const total = (db.prepare(`SELECT COUNT(*) as c FROM decisions`).get() as { c: number }).c
  const data = db.prepare(`
    SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price as estimatedPrice,
           d.reasoning, d.signals_json as signalsJson, d.portfolio_json as portfolioJson,
           o.status as orderStatus, o.t212_order_id as orderId
    FROM decisions d
    LEFT JOIN orders o ON o.decision_id = d.id
    ORDER BY d.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as DecisionRow[]
  return { data, total }
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

export function getOrdersPaginated(page: number, limit: number): { data: OrderRow[]; total: number } {
  const db = getDb()
  const offset = (page - 1) * limit
  const total = (db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as { c: number }).c
  const data = db.prepare(`
    SELECT o.id, o.decision_id as decisionId, o.t212_order_id as t212OrderId,
           o.status, o.fill_price as fillPrice, o.fill_quantity as fillQuantity,
           o.timestamp, d.ticker, d.action
    FROM orders o
    JOIN decisions d ON d.id = o.decision_id
    ORDER BY o.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as OrderRow[]
  return { data, total }
}

export function getDecisionById(id: number): DecisionRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT d.id, d.timestamp, d.action, d.ticker, d.quantity, d.estimated_price as estimatedPrice,
           d.reasoning, d.signals_json as signalsJson, d.portfolio_json as portfolioJson,
           o.status as orderStatus, o.t212_order_id as orderId
    FROM decisions d
    LEFT JOIN orders o ON o.decision_id = d.id
    WHERE d.id = ?
  `).get(id) as DecisionRow | undefined
  return row ?? null
}

export function getOrdersForDay(date: string): Array<{
  action: string
  ticker: string | null
  quantity: number | null
  reasoning: string
  status: string | null
  fillPrice: number | null
}> {
  const db = getDb()
  return db
    .prepare(`
      SELECT d.action, d.ticker, d.quantity, d.reasoning, o.status, o.fill_price as fillPrice
      FROM decisions d
      LEFT JOIN orders o ON o.decision_id = d.id
      WHERE date(d.timestamp) = ? AND d.action != 'hold'
      ORDER BY d.id
    `)
    .all(date) as Array<{
    action: string
    ticker: string | null
    quantity: number | null
    reasoning: string
    status: string | null
    fillPrice: number | null
  }>
}
