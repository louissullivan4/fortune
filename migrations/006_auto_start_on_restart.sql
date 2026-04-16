ALTER TABLE user_configs
  ADD COLUMN IF NOT EXISTS auto_start_on_restart BOOLEAN NOT NULL DEFAULT false;
