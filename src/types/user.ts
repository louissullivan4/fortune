export type DecisionMode = 'ai' | 'deterministic' | 'ai_with_fallback'

export interface UserConfig {
  tradeUniverse: string[]
  tradeIntervalMs: number
  maxBudgetEur: number
  maxPositionPct: number
  dailyLossLimitPct: number
  stopLossPct: number
  takeProfitPct: number
  stagnantExitEnabled: boolean
  stagnantTimeMinutes: number
  stagnantRangePct: number
  /**
   * Soft time-stop: exit a position that has been held for at least
   * `softStopHoldMinutes` AND is currently more than `softStopDrawdownPct`
   * below entry AND has never armed the trailing stop. Catches dying trades
   * before they bleed into the full stop-loss.
   */
  softStopEnabled: boolean
  softStopHoldMinutes: number
  softStopDrawdownPct: number
  /**
   * 'ai'              — call Claude every cycle (current behaviour).
   * 'deterministic'   — skip Claude entirely; use the shared rules picker.
   * 'ai_with_fallback' — try Claude; on error or MTD-budget exceeded, fall
   *                      back to the deterministic picker for this cycle.
   */
  decisionMode: DecisionMode
  /** Soft cap on month-to-date Anthropic spend before fallback kicks in. */
  aiCostBudgetMonthlyUsd: number
  autoStartOnRestart: boolean
}

export interface JwtPayload {
  userId: string
  email: string
  role: 'admin' | 'client' | 'accountant'
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  tradeUniverse: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA'],
  tradeIntervalMs: 900_000,
  maxBudgetEur: 100,
  maxPositionPct: 0.25,
  dailyLossLimitPct: 0.1,
  stopLossPct: 0.05,
  takeProfitPct: 0.015,
  stagnantExitEnabled: true,
  stagnantTimeMinutes: 120,
  stagnantRangePct: 0.012,
  softStopEnabled: true,
  softStopHoldMinutes: 1440,
  softStopDrawdownPct: 0.05,
  decisionMode: 'ai',
  aiCostBudgetMonthlyUsd: 5,
  autoStartOnRestart: false,
}
