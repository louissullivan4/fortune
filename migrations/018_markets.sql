-- 018_markets.sql — Multi-market trading support
--
-- Adds a markets catalog, a per-(user, market) configuration table, and a
-- market_code column on every data table that previously assumed implicit
-- NYSE-only operation. Existing data is backfilled to market_code='NYSE'.
--
-- Wrapped in a single transaction so the schema either lands fully or not
-- at all. user_configs is dropped at the end after rows are copied into
-- user_market_configs.

BEGIN;

-- ── Markets catalog (identity only — operational details live in code) ────
CREATE TABLE IF NOT EXISTS markets (
  code         TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  currency     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO markets (code, display_name, timezone, currency) VALUES
  ('NYSE',  'NYSE',  'America/New_York', 'USD'),
  ('XETRA', 'Xetra', 'Europe/Berlin',    'EUR')
ON CONFLICT (code) DO NOTHING;

-- ── Per-(user, market) configuration ──────────────────────────────────────
-- One row per market the user has enabled. Presence = enabled. Delete = disable.
CREATE TABLE IF NOT EXISTS user_market_configs (
  id                         SERIAL PRIMARY KEY,
  user_id                    UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  market_code                TEXT    NOT NULL REFERENCES markets(code),
  trade_universe             TEXT    NOT NULL DEFAULT '',
  trade_interval_ms          INTEGER NOT NULL DEFAULT 900000,
  max_budget_eur             REAL    NOT NULL DEFAULT 100,
  max_position_pct           REAL    NOT NULL DEFAULT 0.25,
  daily_loss_limit_pct       REAL    NOT NULL DEFAULT 0.1,
  stop_loss_pct              REAL    NOT NULL DEFAULT 0.05,
  take_profit_pct            REAL    NOT NULL DEFAULT 0.015,
  stagnant_exit_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  stagnant_time_minutes      REAL    NOT NULL DEFAULT 120,
  stagnant_range_pct         REAL    NOT NULL DEFAULT 0.012,
  soft_stop_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  soft_stop_hold_minutes     REAL    NOT NULL DEFAULT 1440,
  soft_stop_drawdown_pct     REAL    NOT NULL DEFAULT 0.05,
  decision_mode              TEXT    NOT NULL DEFAULT 'ai',
  ai_cost_budget_monthly_usd REAL    NOT NULL DEFAULT 5,
  auto_start_on_restart      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, market_code)
);

-- Migrate existing user_configs into NYSE rows of user_market_configs.
-- The IF EXISTS guard lets the migration be re-run on environments that
-- already started fresh post-cutover.
INSERT INTO user_market_configs (
  user_id, market_code,
  trade_universe, trade_interval_ms, max_budget_eur, max_position_pct,
  daily_loss_limit_pct, stop_loss_pct, take_profit_pct,
  stagnant_exit_enabled, stagnant_time_minutes, stagnant_range_pct,
  soft_stop_enabled, soft_stop_hold_minutes, soft_stop_drawdown_pct,
  decision_mode, ai_cost_budget_monthly_usd, auto_start_on_restart,
  updated_at
)
SELECT
  user_id, 'NYSE',
  trade_universe, trade_interval_ms, max_budget_eur, max_position_pct,
  daily_loss_limit_pct, stop_loss_pct, take_profit_pct,
  stagnant_exit_enabled, stagnant_time_minutes, stagnant_range_pct,
  soft_stop_enabled, soft_stop_hold_minutes, soft_stop_drawdown_pct,
  decision_mode, ai_cost_budget_monthly_usd, auto_start_on_restart,
  updated_at
FROM user_configs
ON CONFLICT (user_id, market_code) DO NOTHING;

-- ── market_code on data tables ────────────────────────────────────────────
ALTER TABLE decisions       ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);
ALTER TABLE ai_positions    ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);
ALTER TABLE ai_usage        ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);
ALTER TABLE backtests       ADD COLUMN IF NOT EXISTS market_code TEXT REFERENCES markets(code);

-- Backfill all existing rows as NYSE (the only market in operation pre-cutover).
UPDATE decisions       SET market_code = 'NYSE' WHERE market_code IS NULL;
UPDATE orders          SET market_code = 'NYSE' WHERE market_code IS NULL;
UPDATE ai_positions    SET market_code = 'NYSE' WHERE market_code IS NULL;
UPDATE ai_usage        SET market_code = 'NYSE' WHERE market_code IS NULL;
UPDATE daily_snapshots SET market_code = 'NYSE' WHERE market_code IS NULL;
UPDATE backtests       SET market_code = 'NYSE' WHERE market_code IS NULL;

ALTER TABLE decisions       ALTER COLUMN market_code SET NOT NULL;
ALTER TABLE orders          ALTER COLUMN market_code SET NOT NULL;
ALTER TABLE ai_positions    ALTER COLUMN market_code SET NOT NULL;
ALTER TABLE ai_usage        ALTER COLUMN market_code SET NOT NULL;
ALTER TABLE daily_snapshots ALTER COLUMN market_code SET NOT NULL;
ALTER TABLE backtests       ALTER COLUMN market_code SET NOT NULL;

-- ── Composite indexes for the common query shapes ─────────────────────────
-- 'ALL by user' queries still use these via leading prefix (user_id).
CREATE INDEX IF NOT EXISTS decisions_user_market_ts_idx
  ON decisions (user_id, market_code, timestamp DESC);

CREATE INDEX IF NOT EXISTS orders_user_market_ts_idx
  ON orders (user_id, market_code, timestamp DESC);

CREATE INDEX IF NOT EXISTS ai_positions_user_market_status_idx
  ON ai_positions (user_id, market_code, status);

CREATE INDEX IF NOT EXISTS ai_usage_user_market_ts_idx
  ON ai_usage (user_id, market_code, timestamp DESC);

CREATE INDEX IF NOT EXISTS backtests_user_market_created_idx
  ON backtests (user_id, market_code, created_at DESC);

-- daily_snapshots: drop the old (user_id, date) partial unique and replace
-- with one that includes market_code, so two markets can both write a
-- snapshot for the same calendar date.
DROP INDEX IF EXISTS daily_snapshots_user_date_idx;
CREATE UNIQUE INDEX IF NOT EXISTS daily_snapshots_user_market_date_idx
  ON daily_snapshots (user_id, market_code, date)
  WHERE user_id IS NOT NULL;

-- ── Drop the old single-market user_configs table ─────────────────────────
-- All rows have been copied into user_market_configs above.
DROP TABLE IF EXISTS user_configs;

COMMIT;
