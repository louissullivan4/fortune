-- 004_users.sql — Multi-user authentication & per-user config

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  user_id       UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  username      TEXT        NOT NULL UNIQUE,
  first_name    TEXT        NOT NULL,
  last_name     TEXT        NOT NULL,
  dob           DATE,
  address1      TEXT,
  address2      TEXT,
  city          TEXT,
  county        TEXT,
  country       TEXT,
  zipcode       TEXT,
  phone         TEXT,
  user_role     TEXT        NOT NULL DEFAULT 'client' CHECK (user_role IN ('admin', 'client')),
  is_active     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user API keys (AES-256-GCM encrypted at rest)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id                      SERIAL PRIMARY KEY,
  user_id                 UUID        NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  anthropic_api_key_enc   TEXT,
  t212_api_key_id_enc     TEXT,
  t212_api_key_secret_enc TEXT,
  t212_mode               TEXT        NOT NULL DEFAULT 'demo' CHECK (t212_mode IN ('demo', 'live')),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user trading configuration (replaces global app_config singleton)
CREATE TABLE IF NOT EXISTS user_configs (
  id                    SERIAL PRIMARY KEY,
  user_id               UUID        NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  trade_universe        TEXT        NOT NULL DEFAULT 'AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA',
  trade_interval_ms     INTEGER     NOT NULL DEFAULT 900000,
  max_budget_eur        REAL        NOT NULL DEFAULT 100,
  max_position_pct      REAL        NOT NULL DEFAULT 0.25,
  daily_loss_limit_pct  REAL        NOT NULL DEFAULT 0.1,
  stop_loss_pct         REAL        NOT NULL DEFAULT 0.05,
  take_profit_pct       REAL        NOT NULL DEFAULT 0.015,
  stagnant_exit_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  stagnant_time_minutes REAL        NOT NULL DEFAULT 120,
  stagnant_range_pct    REAL        NOT NULL DEFAULT 0.005,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User invitations (admins invite new users via email)
CREATE TABLE IF NOT EXISTS user_invitations (
  id         SERIAL PRIMARY KEY,
  email      TEXT        NOT NULL,
  token      TEXT        NOT NULL UNIQUE,
  invited_by UUID        REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at    TIMESTAMPTZ,
  is_used    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  used_at    TIMESTAMPTZ,
  is_used    BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Add user_id to existing data tables (nullable for legacy rows)
ALTER TABLE decisions    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE orders       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ai_positions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE ai_usage     ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;

-- daily_snapshots: add user_id; keep date as primary key for legacy rows,
-- add partial unique index for new per-user rows
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS daily_snapshots_user_date_idx
  ON daily_snapshots (user_id, date)
  WHERE user_id IS NOT NULL;

-- ai_portfolio_config: add user_id for per-user tracking
ALTER TABLE ai_portfolio_config ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS ai_portfolio_config_user_idx
  ON ai_portfolio_config (user_id)
  WHERE user_id IS NOT NULL;
