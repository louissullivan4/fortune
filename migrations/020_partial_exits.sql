-- 020_partial_exits.sql — Staged take-profit exits
--
-- Track a single partial-exit event per open position so the take-profit
-- threshold can scale out half (or any configurable fraction) of the
-- position while the remainder rides momentum on a tightened trailing stop.
--
-- All four columns are nullable. A position with NULL partial_exit_at has
-- never partially exited and behaves identically to pre-020 positions. The
-- close path computes realized P&L across the staged fills when these are
-- set.
ALTER TABLE ai_positions
  ADD COLUMN IF NOT EXISTS partial_exit_qty       NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_price     NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_price_eur NUMERIC,
  ADD COLUMN IF NOT EXISTS partial_exit_at        TIMESTAMPTZ;
