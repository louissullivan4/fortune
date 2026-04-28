-- Store ai_positions price columns in EUR alongside the native (instrument
-- currency) values. The legacy entry_price / exit_price / realized_pnl fields
-- are denominated in the instrument currency (USD for *_US_EQ etc.) but every
-- analytics path renders them with a € prefix, overstating P&L on USD trades
-- by ~15% (current USD→EUR ≈ 0.856).
--
-- New columns:
--   entry_price_eur    — populated by the engine at position open from T212's
--                        per-position fxRate.
--   exit_price_eur     — populated at close, same source.
--   realized_pnl_eur   — (exit_eur − entry_eur) × quantity, populated at close.
--   currency_code      — instrument trading currency (e.g. USD, EUR, GBX).
--                        Audit metadata; analytics keys off the EUR columns.
--
-- Legacy columns are preserved for audit. Analytics readers should prefer the
-- _eur columns and fall back to legacy values × a default FX rate only if the
-- new fields are NULL on a row that pre-dates this migration.

ALTER TABLE ai_positions
  ADD COLUMN IF NOT EXISTS entry_price_eur   real,
  ADD COLUMN IF NOT EXISTS exit_price_eur    real,
  ADD COLUMN IF NOT EXISTS realized_pnl_eur  real,
  ADD COLUMN IF NOT EXISTS currency_code     text;

-- Backfill historical USD positions using the spot EUR/USD rate observed on
-- the migration date (2026-04-28: 1 USD = 0.85616 EUR via Frankfurter / ECB).
-- All existing positions across the table are USD-denominated (verified at
-- migration time: SELECT COUNT(*) per inferred currency = 175 USD / 0 other),
-- so a single conversion factor is acceptable. Using a single rate for older
-- trades introduces small drift (intra-month FX moves are typically <1%) but
-- removes the ~15% systematic overstatement that the dashboard currently has.
--
-- Future positions are populated by the engine at open/close time using the
-- live T212-derived fxRate per position — preferable to a single spot rate.

UPDATE ai_positions
SET
  entry_price_eur  = entry_price * 0.85616,
  exit_price_eur   = exit_price  * 0.85616,
  realized_pnl_eur = realized_pnl * 0.85616,
  currency_code    = 'USD'
WHERE ticker LIKE '%\_US\_EQ' ESCAPE '\'
  AND entry_price_eur IS NULL;

CREATE INDEX IF NOT EXISTS ai_positions_user_closed_idx
  ON ai_positions (user_id, status, closed_at DESC)
  WHERE status = 'closed';
