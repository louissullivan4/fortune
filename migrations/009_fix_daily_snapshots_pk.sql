ALTER TABLE daily_snapshots DROP CONSTRAINT daily_snapshots_pkey;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
