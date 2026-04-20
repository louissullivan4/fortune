-- 011_user_markets.sql — Multi-market support (NYSE + XETRA)
--
-- Adds per-user market opt-in (with active-hour windows) and promotes the
-- previously-CSV trade_universe into a relational table with an exchange tag.
--
-- Backfill:
--   • every existing user gets a NYSE row with the default full session enabled
--   • every ticker in user_configs.trade_universe becomes a user_tickers row on NYSE
-- The legacy trade_universe column stays for one release cycle as a safety net;
-- a follow-up migration will drop it.

CREATE TABLE IF NOT EXISTS user_markets (
  id                  SERIAL      PRIMARY KEY,
  user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  exchange_code       TEXT        NOT NULL,
  -- Wall-clock "HH:MM" in the exchange's own timezone.
  active_from_local   TEXT        NOT NULL,
  active_to_local     TEXT        NOT NULL,
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, exchange_code)
);

CREATE INDEX IF NOT EXISTS user_markets_user_idx ON user_markets (user_id);

CREATE TABLE IF NOT EXISTS user_tickers (
  id              SERIAL      PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ticker          TEXT        NOT NULL,
  exchange_code   TEXT        NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS user_tickers_user_idx ON user_tickers (user_id);

-- Backfill: NYSE market window for every existing user.
-- Hours are stored in the user's timezone (Europe/Dublin); NYSE 09:30–16:00 ET
-- == 14:30–21:00 Dublin year-round.
INSERT INTO user_markets (user_id, exchange_code, active_from_local, active_to_local, enabled)
SELECT u.user_id, 'NYSE', '14:30', '21:00', TRUE
FROM users u
ON CONFLICT (user_id, exchange_code) DO NOTHING;

-- Backfill: explode CSV trade_universe into per-ticker rows, default to NYSE.
INSERT INTO user_tickers (user_id, ticker, exchange_code)
SELECT uc.user_id, trim(t), 'NYSE'
FROM user_configs uc,
     LATERAL regexp_split_to_table(COALESCE(uc.trade_universe, ''), ',') AS t
WHERE trim(t) <> ''
ON CONFLICT (user_id, ticker) DO NOTHING;
