import { ConnectionSignal, ChartScatter, Settings } from '@carbon/icons-react';

export const API_ENDPOINTS = {
  ANALYSIS: '/analysis',
  SIGNALS: '/signals',
  TRADES: '/trades',
  EMERGENCY: {
    PAUSE: '/emergency/pause',
    RESUME: '/emergency/resume',
    DUMP_POSITIONS: '/emergency/dump_positions'
  },
  BUILDER: {
    ALGORITHMS: '/algorithms',
    SYMBOLS: '/symbols'
  },
  STRATEGIES: {
    BASE: '/strategies/',
    PUBLISH: (id) => `/strategies/${id}/publish`,
    UNPUBLISH: (id) => `/strategies/${id}/unpublish`,
    BACKTEST: (id) => `/strategies/${id}/backtest`,
    BACKTESTS: (id) => `/strategies/${id}/backtests`,
    YAML: (id) => `/strategies/${id}/config/yaml`
  }
}

export const ROUTES = {
  HOME: '/',
  LIVE: '/live',
  STRATEGIES: '/strategies',
  CREATE_STRATEGY: '/strategies/create',
  EDIT_STRATEGY: (id) => `/strategies/${id}/edit`,
  TEST_STRATEGY: (id) => `/strategies/${id}/test`,
  SETTINGS: '/settings'
}

export const NAV_ITEMS = [
  { path: ROUTES.LIVE, icon: ConnectionSignal, text: 'Live Trading' },
  { path: ROUTES.STRATEGIES, icon: ChartScatter, text: 'Strategies' },
  { path: ROUTES.SETTINGS, icon: Settings, text: 'Settings' },
]

// Field tips for CreateStrategyPage
export const FIELD_TIPS = {
  algorithm: `Select the statistical pairing method to run.  
Choose based on your preference for model complexity vs. responsiveness.`,

  window: `Number of lookback periods used to compute rolling statistics (e.g. mean, σ).  
A shorter window (e.g. 20) reacts quickly to regime shifts but may overfit noise;  
a longer window (e.g. 60) smooths volatility but can lag during trend changes.`,

  entry_z: `Z‑score threshold at which to open a position in the spread.  
Higher values (e.g. ≥2) capture more extreme divergences—fewer signals but higher conviction;  
lower values (e.g. 1–1.5) generate earlier entries but risk mean‑reversion failing.`,

  exit_z: `Z‑score threshold to close an open spread trade.  
Set this below entry_z to lock in gains (e.g. exit at 0 or ±0.5);  
a value near zero ensures you exit once mean‐reversion completes.`,

  risk_per_trade: `Portion of total equity risked per position, expressed as a percentage.  
For example, “2” risks 2% of capital on a single paired trade.  
Keep between 1–5% for balanced drawdown control; never exceed 10%.`
};

// Algorithm descriptions for CreateStrategyPage
export const ALGORITHM_DESCRIPTIONS = {
  PairTrading: 'exploits the mean-reverting relationship between two correlated assets. It enters trades when their price spread diverges and exits when it converges.',
}; 