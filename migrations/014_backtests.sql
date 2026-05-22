CREATE TABLE backtests (
  id                  SERIAL PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress_pct        INT  NOT NULL DEFAULT 0,
  config_json         JSONB NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  initial_cash        NUMERIC(14, 2) NOT NULL,
  final_value         NUMERIC(14, 2),
  realized_pnl        NUMERIC(14, 2),
  total_return_pct    NUMERIC(10, 4),
  max_drawdown_pct    NUMERIC(10, 4),
  win_rate            NUMERIC(6, 4),
  trades_count        INT,
  sharpe              NUMERIC(10, 4),
  metrics_json        JSONB,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX backtests_user_created_idx ON backtests(user_id, created_at DESC);
