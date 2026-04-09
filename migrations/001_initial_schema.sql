-- Initial schema for trader app (Postgres 18)

CREATE TABLE IF NOT EXISTS app_config (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  trade_universe       TEXT    NOT NULL,
  trade_interval_ms    INTEGER NOT NULL,
  max_budget_eur       REAL    NOT NULL,
  max_position_pct     REAL    NOT NULL,
  daily_loss_limit_pct REAL    NOT NULL,
  updated_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id              SERIAL PRIMARY KEY,
  timestamp       TEXT   NOT NULL,
  action          TEXT   NOT NULL,
  ticker          TEXT,
  quantity        REAL,
  estimated_price REAL,
  reasoning       TEXT   NOT NULL,
  signals_json    TEXT   NOT NULL,
  portfolio_json  TEXT   NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  decision_id    INTEGER REFERENCES decisions(id),
  t212_order_id  TEXT,
  status         TEXT NOT NULL,
  fill_price     REAL,
  fill_quantity  REAL,
  timestamp      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  date            TEXT PRIMARY KEY,
  open_value      REAL    NOT NULL,
  close_value     REAL,
  trades_count    INTEGER DEFAULT 0,
  pnl             REAL,
  ai_open_value   REAL,
  ai_close_value  REAL
);

CREATE TABLE IF NOT EXISTS ai_positions (
  id               SERIAL PRIMARY KEY,
  ticker           TEXT NOT NULL,
  opened_at        TEXT NOT NULL,
  quantity         REAL NOT NULL,
  entry_price      REAL,
  high_water_mark  REAL,
  closed_at        TEXT,
  exit_price       REAL,
  realized_pnl     REAL,
  status           TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id               SERIAL PRIMARY KEY,
  decision_id      INTEGER REFERENCES decisions(id),
  timestamp        TEXT NOT NULL,
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  input_cost_usd   REAL NOT NULL,
  output_cost_usd  REAL NOT NULL,
  total_cost_usd   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_portfolio_config (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  started_at     TEXT NOT NULL,
  initial_budget REAL NOT NULL
);
