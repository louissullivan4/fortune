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

const MIN_INTERVAL_MS = 700

class RequestQueue {
  private queue: Array<() => Promise<void>> = []
  private busy = false
  private lastAt = 0

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
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
      if (retries <= 0) throw new Error('T212 rate limited — slow down requests')
      const retryAfter = Number(res.headers.get('Retry-After') ?? 0) * 1000 || 5000
      const msg = `T212 rate limited — retrying in ${retryAfter / 1000}s`
      console.warn(`[t212] ${msg} (${retries} retries left)`)
      hub.broadcast('toast', { message: msg, level: 'warning' })
      await new Promise((r) => setTimeout(r, retryAfter))
      return this.apiFetchInner<T>(path, init, retries - 1)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`T212 API error ${res.status}: ${body}`)
    }
    return res.json() as T
  }

  private apiFetch<T>(path: string, init?: RequestInit, retries = 3): Promise<T> {
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
    const SNAPSHOT_TTL_MS = 20_000
    if (this._snapshotCache && Date.now() < this._snapshotCache.expiresAt) {
      return this._snapshotCache.data
    }
    const positions = await this.getPortfolio()
    const cash = await this.getCash()
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
