import { hub } from '../ws/hub.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface T212Position {
  ticker: string
  quantity: number
  averagePrice: number
  currentPrice: number
  ppl: number
  fxPpl: number | null
  initialFillDate: string
  maxBuy: number | null
  maxSell: number | null
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

export interface T212Instrument {
  ticker: string
  name: string
  shortName: string
  currencyCode: string
  type: string
  minTradeQuantity: number
}

export interface T212Order {
  id: string
  ticker: string
  type: string
  quantity: number
  status: string
  filledQuantity: number
  filledPrice: number | null
  dateCreated: string
  dateModified: string
}

export interface PlaceOrderResult {
  id: string
  ticker: string
  quantity: number
  status: string
  dateCreated: string
}

export interface PortfolioSnapshot {
  cash: T212Cash
  positions: T212Position[]
  totalValue: number
  totalPpl: number
}

// ── Request queue ──────────────────────────────────────────────────────────
// Serialises all T212 API calls with a minimum gap between them.
// Tracks a global rate-limit window so that a 429 on any request
// pauses the entire queue until the window expires.

const MIN_INTERVAL_MS = 1_200 // safely under T212's ~1 req/sec limit

class RequestQueue {
  private queue: Array<() => Promise<void>> = []
  private busy = false
  private lastAt = 0
  private rateLimitedUntil = 0

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        // If a previous 429 set a backoff window, wait it out before issuing anything
        const rlWait = this.rateLimitedUntil - Date.now()
        if (rlWait > 0) await new Promise((r) => setTimeout(r, rlWait))

        const gap = MIN_INTERVAL_MS - (Date.now() - this.lastAt)
        if (gap > 0) await new Promise((r) => setTimeout(r, gap))

        this.lastAt = Date.now()
        try {
          resolve(await fn())
        } catch (e) {
          reject(e)
        }
      })
      this.drain()
    })
  }

  /** Called when a 429 is received — blocks the whole queue until `ms` elapses. */
  setRateLimited(ms: number): void {
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + ms)
  }

  private async drain() {
    if (this.busy) return
    this.busy = true
    while (this.queue.length) await this.queue.shift()!()
    this.busy = false
  }
}

// ── Trading212Client ───────────────────────────────────────────────────────
// One instance per user — holds their own request queue and caches.

export class Trading212Client {
  private q = new RequestQueue()
  private _instrumentCache: Map<string, T212Instrument> | null = null
  private _snapshotCache: { data: PortfolioSnapshot; expiresAt: number } | null = null

  constructor(
    private keyId: string,
    private keySecret: string,
    public readonly mode: 'demo' | 'live'
  ) {}

  private authHeader(): string {
    const credentials = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')
    return `Basic ${credentials}`
  }

  private baseUrl(): string {
    return this.mode === 'demo'
      ? 'https://demo.trading212.com/api/v0'
      : 'https://live.trading212.com/api/v0'
  }

  private async apiFetchInner<T>(
    path: string,
    init: RequestInit | undefined,
    retries: number
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (res.status === 401) throw new Error('T212 auth failed — check API key ID and secret')
    if (res.status === 403) throw new Error('T212 access denied — check key permissions')
    if (res.status === 429) {
      if (retries <= 0) throw new Error('T212 rate limited — too many retries, slow down requests')
      const retryAfterMs = (Number(res.headers.get('Retry-After') ?? 10) * 1000) || 10_000
      // Block the entire queue so no other request fires during the backoff
      this.q.setRateLimited(retryAfterMs)
      const secs = Math.round(retryAfterMs / 1000)
      console.warn(`[t212] Rate limited — queue paused for ${secs}s (${retries} retries left)`)
      hub.broadcast('toast', { message: `T212 rate limited — pausing ${secs}s`, level: 'warning' })
      await new Promise((r) => setTimeout(r, retryAfterMs))
      return this.apiFetchInner<T>(path, init, retries - 1)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`T212 API error ${res.status}: ${body}`)
    }
    return res.json() as T
  }

  private apiFetch<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
    return this.q.enqueue(() => this.apiFetchInner<T>(path, init, retries))
  }

  // ── Instrument cache ─────────────────────────────────────────────────────

  async getInstruments(): Promise<Map<string, T212Instrument>> {
    if (this._instrumentCache) return this._instrumentCache
    const data = await this.apiFetch<T212Instrument[]>('/equity/metadata/instruments')
    this._instrumentCache = new Map(data.map((i) => [i.ticker, i]))
    return this._instrumentCache
  }

  // ── Portfolio & cash ─────────────────────────────────────────────────────

  async getPortfolio(): Promise<T212Position[]> {
    return this.apiFetch<T212Position[]>('/equity/portfolio')
  }

  async getCash(): Promise<T212Cash> {
    return this.apiFetch<T212Cash>('/equity/account/cash')
  }

  // ── Orders ───────────────────────────────────────────────────────────────

  async placeMarketOrder(
    ticker: string,
    quantity: number,
    side: 'buy' | 'sell'
  ): Promise<PlaceOrderResult> {
    const signedQty = side === 'sell' ? -Math.abs(quantity) : Math.abs(quantity)
    return this.apiFetch<PlaceOrderResult>('/equity/orders/market', {
      method: 'POST',
      body: JSON.stringify({ ticker, quantity: signedQty }),
    })
  }

  async getOpenOrders(): Promise<T212Order[]> {
    return this.apiFetch<T212Order[]>('/equity/orders')
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.apiFetch<unknown>(`/equity/orders/${orderId}`, { method: 'DELETE' })
  }

  async getOrderHistory(): Promise<T212Order[]> {
    return this.apiFetch<T212Order[]>('/equity/history/orders?limit=50')
  }

  // ── Portfolio snapshot (with short-lived cache) ───────────────────────────

  invalidatePortfolioCache(): void {
    this._snapshotCache = null
  }

  async getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
    const SNAPSHOT_TTL_MS = 60_000 // 1 minute — reduces T212 calls significantly
    if (this._snapshotCache && Date.now() < this._snapshotCache.expiresAt) {
      return this._snapshotCache.data
    }
    const [positions, cash] = await Promise.all([this.getPortfolio(), this.getCash()])
    const data: PortfolioSnapshot = {
      cash,
      positions,
      totalValue: cash.free + cash.invested + cash.ppl,
      totalPpl: cash.ppl,
    }
    this._snapshotCache = { data, expiresAt: Date.now() + SNAPSHOT_TTL_MS }
    return data
  }
}

// ── Per-user client registry ───────────────────────────────────────────────
// All routes share a single Trading212Client per user, meaning one queue
// coordinates every T212 call regardless of which route triggered it.

const _clients = new Map<string, Trading212Client>()

export function getT212Client(userId: string): Trading212Client | null {
  return _clients.get(userId) ?? null
}

export function getOrCreateT212Client(
  userId: string,
  keyId: string,
  keySecret: string,
  mode: 'demo' | 'live'
): Trading212Client {
  const existing = _clients.get(userId)
  if (existing) return existing
  const client = new Trading212Client(keyId, keySecret, mode)
  _clients.set(userId, client)
  return client
}

/** Call when user updates their T212 keys so the old client is dropped. */
export function evictT212Client(userId: string): void {
  _clients.delete(userId)
}
