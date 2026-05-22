-- Retune soft-stop defaults based on backtest evidence: the 360min / 2.5%
-- configuration over-fired on normal pullbacks in winning tickers and cost
-- ~6pp of return vs no soft-stop at all. 1440min / 5% catches the rare
-- multi-day bleeds without killing recovering positions.

ALTER TABLE user_configs
  ALTER COLUMN soft_stop_hold_minutes SET DEFAULT 1440,
  ALTER COLUMN soft_stop_drawdown_pct SET DEFAULT 0.05;

-- Bring existing rows still on the original defaults onto the new ones.
-- Users who explicitly customised either value are left untouched.
UPDATE user_configs
SET soft_stop_hold_minutes = 1440,
    soft_stop_drawdown_pct = 0.05
WHERE soft_stop_hold_minutes = 360
  AND soft_stop_drawdown_pct = 0.025;
