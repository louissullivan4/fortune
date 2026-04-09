-- Add configurable stop-loss and take-profit thresholds to app_config
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS stop_loss_pct   REAL NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS take_profit_pct REAL NOT NULL DEFAULT 0.015;
