/// <reference types="vite/client" />
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

// ── Token store (in-memory, not localStorage — XSS safe) ─────────────────
let _accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  _accessToken = token
}

export function getAccessToken(): string | null {
  return _accessToken
}

// ── Fetch wrapper with automatic token refresh ─────────────────────────────

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts?.headers as Record<string, string>),
  }
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`

  let res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...opts,
    headers,
  })

  // On 401, attempt token refresh then retry once
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
    const refreshRes = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (refreshRes.ok) {
      const { accessToken } = await refreshRes.json()
      _accessToken = accessToken
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        ...opts,
        headers,
      })
    } else {
      // Refresh failed — clear token and let the error propagate
      _accessToken = null
      throw new Error('Session expired — please log in again')
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string
  email: string
  role: 'admin' | 'client'
  firstName: string
}

export interface UserProfile {
  user_id: string
  email: string
  username: string
  first_name: string
  last_name: string
  dob: string | null
  address1: string | null
  address2: string | null
  city: string | null
  county: string | null
  country: string | null
  zipcode: string | null
  phone: string | null
  user_role: string
  is_active: boolean
  created_at: string
  t212_mode: string
  has_anthropic_key: boolean
  has_t212_key: boolean
}

export interface Invitation {
  id: number
  email: string
  is_used: boolean
  created_at: string
  expires_at: string
  used_at: string | null
  invited_by_username: string | null
}

export interface EngineStatus {
  running: boolean
  startedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  cycleCount: number
  marketOpen: boolean
  mode: string
  intervalMs: number
  pendingSettlement: number
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
  manualPositions: T212Position[]
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

export interface DailyStatsPoint {
  date: string
  pnl: number | null
  tradesCount: number
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

export interface PnlPosition {
  id: number
  ticker: string
  openedAt: string
  closedAt: string | null
  quantity: number
  entryPrice: number | null
  exitPrice: number | null
  grossPnl: number | null
  fxCost: number
  netPnl: number | null
  hasActualFill: boolean
}

export interface SignalEntry {
  ticker: string
  signal: SignalType
  reasons: string[]
}

export interface DecisionDetail {
  timestamp: string
  reasoning: string
  signals: SignalEntry[]
  orderStatus: string | null
}

export interface PositionDetails {
  buyDecision: DecisionDetail | null
  sellDecision: DecisionDetail | null
}

export interface PnlSummary {
  totalGrossPnl: number
  totalFxCost: number
  totalNetPnl: number
  wins: number
  losses: number
  winRate: number | null
  totalTrades: number
}

export interface PnlByDay {
  date: string
  grossPnl: number
  netPnl: number
}

export interface PnlResponse {
  positions: PnlPosition[]
  byDay: PnlByDay[]
  summary: PnlSummary
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
  stopLossPct: number
  takeProfitPct: number
  stagnantExitEnabled: boolean
  stagnantTimeMinutes: number
  stagnantRangePct: number
  autoStartOnRestart: boolean
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
  auth: {
    login: (email: string, password: string) =>
      req<{ accessToken: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => req<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
    refresh: () => req<{ accessToken: string }>('/auth/refresh', { method: 'POST' }),
    me: () => req<AuthUser>('/auth/me'),
    verifyInvite: (token: string) =>
      req<{ email: string; valid: boolean }>(`/auth/invite/verify?token=${token}`),
    createAccount: (body: Record<string, string>) =>
      req<{ accessToken: string; user: AuthUser }>('/auth/create-account', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    forgotPassword: (email: string) =>
      req<{ ok: boolean }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, password: string) =>
      req<{ ok: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
  },

  users: {
    me: () => req<UserProfile>('/users/me'),
    updateMe: (body: Partial<UserProfile>) =>
      req<{ ok: boolean }>('/users/me', { method: 'PUT', body: JSON.stringify(body) }),
    updatePassword: (currentPassword: string, newPassword: string) =>
      req<{ ok: boolean }>('/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    getApiKeys: () =>
      req<{ hasAnthropicKey: boolean; hasT212Key: boolean; t212Mode: string }>(
        '/users/me/api-keys'
      ),
    updateApiKeys: (body: {
      anthropicApiKey?: string
      t212KeyId?: string
      t212KeySecret?: string
      t212Mode?: string
    }) =>
      req<{ ok: boolean }>('/users/me/api-keys', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    getConfig: () => req<Config>('/users/me/config'),
    updateConfig: (body: Partial<Config>) =>
      req<Config>('/users/me/config', { method: 'PUT', body: JSON.stringify(body) }),

    // Admin
    list: () => req<UserProfile[]>('/users'),
    get: (userId: string) => req<UserProfile>(`/users/${userId}`),
    invite: (email: string) =>
      req<{ ok: boolean; email: string }>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    invitations: () => req<Invitation[]>('/users/invitations'),
    setRole: (userId: string, role: string) =>
      req<{ ok: boolean }>(`/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
    setActive: (userId: string, isActive: boolean) =>
      req<{ ok: boolean }>(`/users/${userId}/active`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      }),
  },

  health: () =>
    req<{ status: string; uptime: number; wsConnections: number }>('/health'.replace('/api', '')),

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
    list: (page = 1, limit = 20) =>
      req<Paginated<Decision>>(`/decisions?page=${page}&limit=${limit}`),
    get: (id: number) => req<Decision>(`/decisions/${id}`),
  },

  orders: {
    list: (page = 1, limit = 20) => req<Paginated<Order>>(`/orders?page=${page}&limit=${limit}`),
  },

  analytics: {
    summary: () => req<Summary>('/analytics/summary'),
    snapshots: (limit = 90) =>
      req<{ data: DailySnapshot[] }>(`/analytics/snapshots?limit=${limit}`),
    intraday: (hours: number) =>
      req<{ data: IntradayPoint[]; hours: number }>(`/analytics/intraday?hours=${hours}`),
    aiCost: () => req<AiCostResponse>('/analytics/ai-cost'),
    positions: () => req<{ open: AiPosition[]; closed: AiPosition[] }>('/analytics/positions'),
    performance: () => req<Performance>('/analytics/performance'),
    dailyStats: (limit = 365) =>
      req<{ data: DailyStatsPoint[] }>(`/analytics/daily-stats?limit=${limit}`),
    pnl: (from?: string, to?: string) => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString()
      return req<PnlResponse>(`/analytics/pnl${qs ? `?${qs}` : ''}`)
    },
    positionDetails: (id: number) => req<PositionDetails>(`/analytics/positions/${id}/details`),
  },

  config: {
    get: () => req<Config>('/config'),
    update: (body: Partial<Config>) =>
      req<Config>('/config', { method: 'PUT', body: JSON.stringify(body) }),
  },

  instruments: {
    search: (q: string) =>
      req<{ data: Instrument[]; total: number }>(`/instruments/search?q=${encodeURIComponent(q)}`),
    lookup: async (ticker: string): Promise<Instrument | null> => {
      const res = await req<{ data: Instrument[]; total: number }>(
        `/instruments/search?q=${encodeURIComponent(ticker)}`
      )
      return res.data.find((i) => i.ticker === ticker) ?? null
    },
  },
}
