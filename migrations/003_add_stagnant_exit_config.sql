-- Add stagnant position rotation config to app_config
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS stagnant_exit_enabled  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stagnant_time_minutes  REAL    NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS stagnant_range_pct     REAL    NOT NULL DEFAULT 0.005;
