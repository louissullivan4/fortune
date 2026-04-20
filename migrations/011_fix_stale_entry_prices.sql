-- Fix ai_positions records where entry_price was recorded from a stale daily-close
-- signal rather than the actual T212 fill price.
--
-- Root cause: when a stock gaps up intraday the Yahoo Finance daily-bar currentPrice
-- (yesterday's close) diverges from the live T212 market price. The bot stored the
-- stale signal price as entry_price, causing take-profit to fire immediately and
-- realized_pnl to be overstated.
--
-- Affected records identified by: (exit_price - entry_price) / entry_price > 8%
-- AND held < 5 minutes. Only one record found as of 2026-04-20.

-- PINS_US_EQ position #104 (user 79dc4ac9):
--   entry_price = 17.14 (stale daily close), actual fill ≈ 20.21 (exit price)
--   realized_pnl = 162.71 (fictitious), should be ≈ 0 (buy and sell at same price)
UPDATE ai_positions
SET
  entry_price  = exit_price,
  realized_pnl = 0
WHERE id = 104
  AND ticker = 'PINS_US_EQ'
  AND user_id = '79dc4ac9-f6b0-4731-aafc-359ff7f8349f'
  AND status = 'closed'
  AND entry_price = 17.14
  AND exit_price  = 20.21;
