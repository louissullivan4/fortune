const BASE = '/api'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface EngineStatus {
  running: boolean
  startedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  cycleCount: number
  marketOpen: boolean
  mode: string
  intervalMs: number
}

export interface T212Position {
  ticker: string
  quantity: number
  averagePrice: number
  currentPrice: number
  ppl: number
  fxPpl: number | null
  initialFillDate: string
}

export interface T212Cash {
  free: number
  total: number
  ppl: number
  result: number
  invested: number
  pieCash: number
  blocked: number
}

export interface Portfolio {
  cash: T212Cash
  positions: T212Position[]
  totalValue: number
  totalPpl: number
  aiPositions: AiPosition[]
}

export interface Indicators {
  ticker: string
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  ema9: number | null
  ema21: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  macdBullCross: boolean | null
  macdBearCross: boolean | null
  bollingerUpper: number | null
  bollingerMiddle: number | null
  bollingerLower: number | null
  bollingerPctB: number | null
  stochK: number | null
  stochD: number | null
  currentPrice: number | null
  priceChange1d: number | null
}

export type SignalType = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'

export interface TickerSignal {
  ticker: string
  signal: SignalType
  indicators: Indicators
  reasons: string[]
  heldPosition: T212Position | null
}

export interface SignalsResponse {
  data: TickerSignal[]
  computedAt: string
  cached: boolean
}

export interface Decision {
  id: number
  timestamp: string
  action: string
  ticker: string | null
  quantity: number | null
  estimatedPrice: number | null
  reasoning: string
  signalsJson: string
  portfolioJson: string
  orderStatus: string | null
  orderId: string | null
  signals?: unknown[]
  portfolio?: unknown
}

export interface Order {
  id: number
  decisionId: number
  t212OrderId: string | null
  status: string
  fillPrice: number | null
  fillQuantity: number | null
  timestamp: string
  ticker: string | null
  action: string
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface DailySnapshot {
  date: string
  value: number
}

export interface IntradayPoint {
  timestamp: string
  value: number
}

export interface AiPosition {
  id: number
  ticker: string
  openedAt: string
  quantity: number
  entryPrice: number | null
  closedAt: string | null
  exitPrice: number | null
  realizedPnl: number | null
  status: 'open' | 'closed'
}

export interface Summary {
  totalDecisions: number
  totalTrades: number
  daysTraded: number
  realizedPnl: number
  winRate: number | null
  closedPositions: number
  portfolioConfig: { startedAt: string; initialBudget: number } | null
  aiCostUsd: number
  aiCallCount: number
}

export interface AiUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  callCount: number
  avgCostPerCallUsd: number
}

export interface AiUsageDay {
  date: string
  costUsd: number
  calls: number
}

export interface AiCostResponse {
  summary: AiUsageSummary
  byDay: AiUsageDay[]
}

export interface Performance {
  totalDecisions: number
  totalTrades: number
  daysTraded: number
  realizedPnl: number
  winRate: number | null
  avgWin: number | null
  avgLoss: number | null
  wins: number
  losses: number
  openPositions: number
  closedPositions: number
}

export interface Config {
  tradeUniverse: string[]
  tradeIntervalMs: number
  tradeIntervalS: number
  maxBudgetEur: number
  maxPositionPct: number
  dailyLossLimitPct: number
  trading212Mode: string
}

export interface Instrument {
  ticker: string
  name: string
  shortName: string
  currencyCode: string
  type: string
  minTradeQuantity: number
}

// ── API functions ─────────────────────────────────────────────────────────

export const api = {
  health: () => req<{ status: string; uptime: number; wsConnections: number }>('/health'.replace('/api', '')),

  engine: {
    status: () => req<EngineStatus>('/engine/status'),
    start: () => req<EngineStatus>('/engine/start', { method: 'POST' }),
    stop: () => req<EngineStatus>('/engine/stop', { method: 'POST' }),
    cycle: () => req<EngineStatus>('/engine/cycle', { method: 'POST' }),
  },

  portfolio: {
    get: () => req<Portfolio>('/portfolio'),
  },

  signals: {
    get: () => req<SignalsResponse>('/signals'),
    refresh: () => req<SignalsResponse>('/signals/refresh', { method: 'POST' }),
    ticker: (t: string) => req<{ data: TickerSignal; computedAt: string }>(`/signals/${t}`),
  },

  decisions: {
    list: (page = 1, limit = 20) => req<Paginated<Decision>>(`/decisions?page=${page}&limit=${limit}`),
    get: (id: number) => req<Decision>(`/decisions/${id}`),
  },

  orders: {
    list: (page = 1, limit = 20) => req<Paginated<Order>>(`/orders?page=${page}&limit=${limit}`),
  },

  analytics: {
    summary: () => req<Summary>('/analytics/summary'),
    snapshots: (limit = 90) => req<{ data: DailySnapshot[] }>(`/analytics/snapshots?limit=${limit}`),
    intraday: (hours: number) => req<{ data: IntradayPoint[]; hours: number }>(`/analytics/intraday?hours=${hours}`),
    aiCost: () => req<AiCostResponse>('/analytics/ai-cost'),
    positions: () => req<{ open: AiPosition[]; closed: AiPosition[] }>('/analytics/positions'),
    performance: () => req<Performance>('/analytics/performance'),
  },

  config: {
    get: () => req<Config>('/config'),
    update: (body: Partial<Config>) => req<Config>('/config', { method: 'PUT', body: JSON.stringify(body) }),
  },

  instruments: {
    search: (q: string) => req<{ data: Instrument[]; total: number }>(`/instruments/search?q=${encodeURIComponent(q)}`),
    lookup: async (ticker: string): Promise<Instrument | null> => {
      const res = await req<{ data: Instrument[]; total: number }>(`/instruments/search?q=${encodeURIComponent(ticker)}`)
      return res.data.find((i) => i.ticker === ticker) ?? null
    },
  },
}
