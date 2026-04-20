import type { ExchangeCode } from '../engine/markets.js'

export interface MarketConfig {
  exchange: ExchangeCode
  enabled: boolean
  /** Wall-clock HH:MM in the user's timezone (Europe/Dublin). */
  activeFrom: string
  activeTo: string
  tradeIntervalMs: number
  maxBudgetEur: number
  maxPositionPct: number
  dailyLossLimitPct: number
  stopLossPct: number
  takeProfitPct: number
  stagnantExitEnabled: boolean
  stagnantTimeMinutes: number
  stagnantRangePct: number
}

export interface UniverseEntry {
  ticker: string
  exchange: ExchangeCode
}

export interface UserConfig {
  markets: MarketConfig[]
  tradeUniverse: UniverseEntry[]
  autoStartOnRestart: boolean
}

export interface JwtPayload {
  userId: string
  email: string
  role: 'admin' | 'client' | 'accountant'
}

const DEFAULT_NYSE: MarketConfig = {
  exchange: 'NYSE',
  enabled: true,
  activeFrom: '14:30',
  activeTo: '21:00',
  tradeIntervalMs: 900_000,
  maxBudgetEur: 100,
  maxPositionPct: 0.25,
  dailyLossLimitPct: 0.1,
  stopLossPct: 0.05,
  takeProfitPct: 0.015,
  stagnantExitEnabled: true,
  stagnantTimeMinutes: 120,
  stagnantRangePct: 0.012,
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  markets: [DEFAULT_NYSE],
  tradeUniverse: [
    { ticker: 'AAPL', exchange: 'NYSE' },
    { ticker: 'MSFT', exchange: 'NYSE' },
    { ticker: 'GOOGL', exchange: 'NYSE' },
    { ticker: 'AMZN', exchange: 'NYSE' },
    { ticker: 'TSLA', exchange: 'NYSE' },
    { ticker: 'NVDA', exchange: 'NYSE' },
  ],
  autoStartOnRestart: false,
}

/** Returns per-market defaults when a user toggles on a new exchange. */
export function defaultMarketConfig(exchange: ExchangeCode): MarketConfig {
  const base = { ...DEFAULT_NYSE, exchange, enabled: true }
  if (exchange === 'XETR') {
    return { ...base, activeFrom: '08:00', activeTo: '16:30' }
  }
  return base
}
