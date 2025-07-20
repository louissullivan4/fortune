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
  { path: ROUTES.LIVE, icon: '⚡', text: 'Live Trading' },
  { path: ROUTES.STRATEGIES, icon: '🎯', text: 'Strategies' },
  { path: ROUTES.SETTINGS, icon: '⚙️', text: 'Configuration' }
]

// Field tips for CreateStrategyPage
export const FIELD_TIPS = {
  algorithm: 'The trading algorithm to use.',
  symbol1: 'The first asset to trade in the pair.',
  symbol2: 'The second asset to trade. Should be different from Symbol 1.',
  window: 'The lookback window (in periods) for calculating statistics like mean and standard deviation.',
  entry_z: 'The Z-score threshold for entering a trade. Higher values mean fewer, more extreme signals.',
  exit_z: 'The Z-score threshold for exiting a trade. Lower values mean quicker exits.',
  risk_per_trade: 'The percentage of your capital to risk on each trade. Must be between 1 and 100.'
};

// Algorithm descriptions for CreateStrategyPage
export const ALGORITHM_DESCRIPTIONS = {
  PairTrading: 'exploits the mean-reverting relationship between two correlated assets. It enters trades when their price spread diverges and exits when it converges.',
}; 