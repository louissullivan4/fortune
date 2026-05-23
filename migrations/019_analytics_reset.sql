-- 019_analytics_reset.sql — Soft cutoff for analytics views
--
-- Users can mark a point in time before which their analytics UI hides all
-- positions, decisions, daily snapshots and AI cost data. The underlying rows
-- remain in the database so reports and offline analysis still see them.
--
-- Reset is per-user (one cutoff applies across every market). NULL means no
-- cutoff and the UI shows the full history.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS analytics_reset_at TIMESTAMPTZ;
