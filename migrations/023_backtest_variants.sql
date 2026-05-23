-- 023_backtest_variants.sql — Link a backtest to its comparison variant
--
-- When a user runs a side-by-side comparison, the runner creates two
-- backtest rows sharing the same historical data. The second row points
-- back to the first via variant_of so the UI can render them together.
ALTER TABLE backtests
  ADD COLUMN IF NOT EXISTS variant_of INTEGER REFERENCES backtests(id) ON DELETE SET NULL;
