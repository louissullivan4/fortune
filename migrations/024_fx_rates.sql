-- 024_fx_rates.sql — Persistent last-known FX rates (EUR per 1 native unit)
--
-- Root cause being fixed: at position-open time a fresh T212 position has
-- currentPrice == averagePrice, so the algebraic FX derivation in api/fx.ts
-- returns null and the code falls back to a Frankfurter HTTP call. On any
-- network failure that call returned 1.0, which the engine then stored as
-- entry_price_eur — i.e. native USD recorded as EUR. The in-memory FX cache
-- was also wiped on every redeploy, so the first US buy after a deploy was
-- maximally exposed. Closes booked the real (~0.85) rate, producing a phantom
-- ~15% loss on otherwise-flat/winning USD trades.
--
-- This table persists every successfully resolved rate so a transient
-- Frankfurter failure (or a fresh process) reuses the last-known good rate
-- instead of 1.0. api/fx.ts seeds its in-memory cache from here on startup
-- and upserts here whenever it resolves a rate.

CREATE TABLE IF NOT EXISTS fx_rates (
  currency   TEXT PRIMARY KEY,
  rate       REAL NOT NULL CHECK (rate > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the one currency in active use so the very first post-deploy buy is
-- never exposed to the 1.0 fallback. ECB EUR/USD on 2026-04-28 = 0.85616.
INSERT INTO fx_rates (currency, rate) VALUES ('USD', 0.85616)
ON CONFLICT (currency) DO NOTHING;
