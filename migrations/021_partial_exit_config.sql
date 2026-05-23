-- 021_partial_exit_config.sql — Partial-exit tunables on user_market_configs
--
-- partial_exit_pct: fraction of the live position to sell when the
-- take-profit threshold (take_profit_pct) is first reached. 1.0 reproduces
-- the pre-020 binary take-profit. 0.5 (the new default) sells half and
-- keeps the remainder open with a tightened trailing stop.
--
-- trail_pullback_after_partial_pct: pullback percentage that triggers the
-- trailing-stop exit on the remainder once partial has fired. Tighter than
-- the pre-partial 0.4% because half the win is already realized.
ALTER TABLE user_market_configs
  ADD COLUMN IF NOT EXISTS partial_exit_pct                  REAL NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS trail_pullback_after_partial_pct  REAL NOT NULL DEFAULT 0.003;
