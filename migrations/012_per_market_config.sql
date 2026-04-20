-- 012_per_market_config.sql — Move risk/budget/interval config from
-- user_configs (one row per user, global) onto user_markets (one row per
-- (user, exchange)). Each enabled market becomes its own self-contained
-- sandbox with budget isolation.
--
-- Adds `daily_market_snapshots` for per-market daily loss tracking.
--
-- Backfill: each user's existing user_markets rows copy values from that
-- user's user_configs row so nothing changes for anyone currently mid-flight.

ALTER TABLE user_markets
  ADD COLUMN IF NOT EXISTS trade_interval_ms     INTEGER,
  ADD COLUMN IF NOT EXISTS max_budget_eur        REAL,
  ADD COLUMN IF NOT EXISTS max_position_pct      REAL,
  ADD COLUMN IF NOT EXISTS daily_loss_limit_pct  REAL,
  ADD COLUMN IF NOT EXISTS stop_loss_pct         REAL,
  ADD COLUMN IF NOT EXISTS take_profit_pct       REAL,
  ADD COLUMN IF NOT EXISTS stagnant_exit_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS stagnant_time_minutes REAL,
  ADD COLUMN IF NOT EXISTS stagnant_range_pct    REAL;

-- Backfill from user_configs to each user's market rows.
UPDATE user_markets um
SET trade_interval_ms     = COALESCE(um.trade_interval_ms,     uc.trade_interval_ms),
    max_budget_eur        = COALESCE(um.max_budget_eur,        uc.max_budget_eur),
    max_position_pct      = COALESCE(um.max_position_pct,      uc.max_position_pct),
    daily_loss_limit_pct  = COALESCE(um.daily_loss_limit_pct,  uc.daily_loss_limit_pct),
    stop_loss_pct         = COALESCE(um.stop_loss_pct,         uc.stop_loss_pct),
    take_profit_pct       = COALESCE(um.take_profit_pct,       uc.take_profit_pct),
    stagnant_exit_enabled = COALESCE(um.stagnant_exit_enabled, uc.stagnant_exit_enabled),
    stagnant_time_minutes = COALESCE(um.stagnant_time_minutes, uc.stagnant_time_minutes),
    stagnant_range_pct    = COALESCE(um.stagnant_range_pct,    uc.stagnant_range_pct)
FROM user_configs uc
WHERE um.user_id = uc.user_id;

-- Backfill anything still null (e.g. markets created without a user_configs
-- row) with engine defaults.
UPDATE user_markets SET
  trade_interval_ms     = COALESCE(trade_interval_ms,     900000),
  max_budget_eur        = COALESCE(max_budget_eur,        100),
  max_position_pct      = COALESCE(max_position_pct,      0.25),
  daily_loss_limit_pct  = COALESCE(daily_loss_limit_pct,  0.1),
  stop_loss_pct         = COALESCE(stop_loss_pct,         0.05),
  take_profit_pct       = COALESCE(take_profit_pct,       0.015),
  stagnant_exit_enabled = COALESCE(stagnant_exit_enabled, TRUE),
  stagnant_time_minutes = COALESCE(stagnant_time_minutes, 120),
  stagnant_range_pct    = COALESCE(stagnant_range_pct,    0.012)
WHERE trade_interval_ms IS NULL
   OR max_budget_eur IS NULL
   OR max_position_pct IS NULL
   OR daily_loss_limit_pct IS NULL
   OR stop_loss_pct IS NULL
   OR take_profit_pct IS NULL
   OR stagnant_exit_enabled IS NULL
   OR stagnant_time_minutes IS NULL
   OR stagnant_range_pct IS NULL;

-- Enforce NOT NULL post-backfill.
ALTER TABLE user_markets
  ALTER COLUMN trade_interval_ms     SET NOT NULL,
  ALTER COLUMN max_budget_eur        SET NOT NULL,
  ALTER COLUMN max_position_pct      SET NOT NULL,
  ALTER COLUMN daily_loss_limit_pct  SET NOT NULL,
  ALTER COLUMN stop_loss_pct         SET NOT NULL,
  ALTER COLUMN take_profit_pct       SET NOT NULL,
  ALTER COLUMN stagnant_exit_enabled SET NOT NULL,
  ALTER COLUMN stagnant_time_minutes SET NOT NULL,
  ALTER COLUMN stagnant_range_pct    SET NOT NULL;

-- Drop the now-redundant columns from user_configs.
ALTER TABLE user_configs
  DROP COLUMN IF EXISTS trade_universe,
  DROP COLUMN IF EXISTS trade_interval_ms,
  DROP COLUMN IF EXISTS max_budget_eur,
  DROP COLUMN IF EXISTS max_position_pct,
  DROP COLUMN IF EXISTS daily_loss_limit_pct,
  DROP COLUMN IF EXISTS stop_loss_pct,
  DROP COLUMN IF EXISTS take_profit_pct,
  DROP COLUMN IF EXISTS stagnant_exit_enabled,
  DROP COLUMN IF EXISTS stagnant_time_minutes,
  DROP COLUMN IF EXISTS stagnant_range_pct;

-- Per-market daily snapshot for the daily-loss-halt check.
CREATE TABLE IF NOT EXISTS daily_market_snapshots (
  user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  exchange_code  TEXT NOT NULL,
  ai_open_value  REAL NOT NULL,
  PRIMARY KEY (user_id, date, exchange_code)
);

CREATE INDEX IF NOT EXISTS daily_market_snapshots_user_date_idx
  ON daily_market_snapshots (user_id, date);
