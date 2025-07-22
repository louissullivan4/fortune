import { ConnectionSignal, ChartScatter, Settings } from "@carbon/icons-react";

export const API_ENDPOINTS = {
  STRATEGIES: {
    BASE: "/strategies/",
    PUBLISH: (id) => `/strategies/${id}/publish`,
    UNPUBLISH: (id) => `/strategies/${id}/unpublish`,
    BACKTEST: (id) => `/strategies/${id}/backtest`,
    BACKTESTS: (id) => `/strategies/${id}/backtests`,
  },
};

export const ROUTES = {
  HOME: "/",
  LIVE: "/live",
  STRATEGIES: "/strategies",
  CREATE_STRATEGY: "/strategies/create",
  EDIT_STRATEGY: (id) => `/strategies/${id}/edit`,
  TEST_STRATEGY: (id) => `/strategies/${id}/test`,
  SETTINGS: "/settings",
};

export const NAV_ITEMS = [
  { path: ROUTES.LIVE, icon: ConnectionSignal, text: "Live Trading" },
  { path: ROUTES.STRATEGIES, icon: ChartScatter, text: "Strategies" },
  { path: ROUTES.SETTINGS, icon: Settings, text: "Settings" },
];

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

  risk_per_trade: `Portion of total equity risked per position.  
For Pair Trading, this is a percentage of capital (e.g. “2” risks 2% of capital per trade).  
For Bollinger Reversion, this is a fixed dollar amount (e.g. “1000” risks $1000 per trade).  
Keep between 1–5% or a modest dollar value for balanced drawdown control.`,

  symbol1: `First asset in the pair. Use the instrument's ticker symbol (e.g. AAPL).`,
  symbol2: `Second asset in the pair. Must differ from Symbol 1.`,
  symbol: `Asset to trade. Use the instrument's ticker symbol (e.g. AAPL).`,
  num_std: `Number of standard deviations for the Bollinger Bands.  
Typical values are 2.0 (default). Higher values mean fewer trades, lower values mean more trades.`,
};

export const ALGORITHM_DESCRIPTIONS = {
  PairTrading:
    "exploits the mean-reverting relationship between two correlated assets. It enters trades when their price spread diverges and exits when it converges.",
  BollingerReversionStrategy:
    "trades a single asset using Bollinger Bands. It enters long when price touches the lower band, short at the upper band, and exits when price reverts to the moving average.",
};
