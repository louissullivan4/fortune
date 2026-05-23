import type { UserConfig } from '../types/user.js'

export interface BacktestConfig extends UserConfig {
  name: string
  /** ISO date YYYY-MM-DD (inclusive). */
  startDate: string
  /** ISO date YYYY-MM-DD (inclusive). */
  endDate: string
  /** Starting EUR balance for the simulation. */
  initialCash: number
  /** Target market for this backtest (e.g. 'NYSE', 'XETRA'). Per the design,
   * one backtest = one market — runs that combine markets are not supported. */
  market: string
  /** Constant bid-ask slippage applied to every fill. Default 15 bps for NYSE
   *  liquid names, 25 for XETRA. Buys fill at close×(1+bps/10000), sells at
   *  close×(1−bps/10000). */
  slippageBps?: number
  /** Round-trip FX conversion cost for foreign-currency tickers (e.g. USD
   *  stocks from a EUR account). Default 0.003 = 0.15% per leg × 2 legs.
   *  Applied once on entry and once on exit. */
  fxRoundTripPct?: number
}

export interface ClosedTrade {
  ticker: string
  openedAt: string
  closedAt: string
  quantity: number
  entryPrice: number
  exitPrice: number
  realizedPnl: number
  exitReason:
    | 'stop_loss'
    | 'take_profit'
    | 'trailing_stop'
    | 'soft_stop'
    | 'stagnant_rotation'
    | 'end_of_run'
  holdMinutes: number
}

export interface EquityPoint {
  /** Epoch ms. */
  t: number
  /** Bot portfolio value in EUR (cash + open positions valued at last close). */
  value: number
}

export interface BacktestMetrics {
  initialCash: number
  finalValue: number
  realizedPnl: number
  totalReturnPct: number
  maxDrawdownPct: number
  winRate: number | null
  tradesCount: number
  sharpe: number | null
  equityCurve: EquityPoint[]
  trades: ClosedTrade[]
  /** Diagnostic counts to help debug surprising results. */
  cyclesRun: number
  signalsEvaluated: number
  buysExecuted: number
  sellsExecuted: number
  blockedByRisk: number
}

export interface BacktestSummary {
  finalValue: number
  realizedPnl: number
  totalReturnPct: number
  maxDrawdownPct: number
  winRate: number | null
  tradesCount: number
  sharpe: number | null
}
