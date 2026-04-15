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
// Serialises all T212 API calls. Paces requests using the rate-limit headers
// T212 returns on every response (x-ratelimit-remaining / x-ratelimit-reset).
// Falls back to a conservative interval when headers are absent.
// A 429 also sets a hard backoff from the Retry-After header.

const FALLBACK_INTERVAL_MS = 1_500
const MIN_BURST_GAP_MS = 100

class RequestQueue {
  private queue: Array<() => Promise<void>> = []
  private busy = false
  private lastAt = 0
  private rateLimitedUntil = 0
  private limitRemaining: number | null = null
  private limitResetAt = 0

  updateFromHeaders(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining')
    const reset = headers.get('x-ratelimit-reset')
    if (remaining !== null) this.limitRemaining = Number(remaining)
    if (reset !== null) {
      const val = Number(reset)
      // Unix timestamp in seconds vs seconds-until-reset
      this.limitResetAt = val > 1_000_000_000 ? val * 1_000 : Date.now() + val * 1_000
    }
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        const rlWait = this.rateLimitedUntil - Date.now()
        if (rlWait > 0) await new Promise((r) => setTimeout(r, rlWait))

        if (
          this.limitRemaining !== null &&
          this.limitRemaining <= 0 &&
          this.limitResetAt > Date.now()
        ) {
          const resetWait = this.limitResetAt - Date.now() + 200
          console.log(
            `[t212] Rate limit capacity exhausted — waiting ${Math.round(resetWait / 1_000)}s for window reset`
          )
          await new Promise((r) => setTimeout(r, resetWait))
          this.limitRemaining = null
        }

        const elapsed = Date.now() - this.lastAt
        const minGap = this.limitRemaining === null ? FALLBACK_INTERVAL_MS : MIN_BURST_GAP_MS
        const gap = minGap - elapsed
        if (gap > 0) await new Promise((r) => setTimeout(r, gap))

        this.lastAt = Date.now()
        if (this.limitRemaining !== null && this.limitRemaining > 0) this.limitRemaining--

        try {
          resolve(await fn())
        } catch (e) {
          reject(e)
        }
      })
      this.drain()
    })
  }

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
  private _instrumentsInFlight: Promise<Map<string, T212Instrument>> | null = null
  private _snapshotCache: { data: PortfolioSnapshot; expiresAt: number } | null = null
  private _snapshotRefreshing = false
  private _snapshotInFlight: Promise<PortfolioSnapshot> | null = null

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
    console.log(`[t212] → ${init?.method ?? 'GET'} ${path}`)
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    this.q.updateFromHeaders(res.headers)
    if (res.status === 401) throw new Error('T212 auth failed — check API key ID and secret')
    if (res.status === 403) throw new Error('T212 access denied — check key permissions')
    if (res.status === 429) {
      if (retries <= 0) throw new Error('T212 rate limited — too many retries, slow down requests')
      const retryAfterSecs = Number(res.headers.get('Retry-After') ?? 0)
      const resetHeader = res.headers.get('x-ratelimit-reset')
      let backoffMs: number
      if (resetHeader) {
        const resetVal = Number(resetHeader)
        const resetMs = resetVal > 1_000_000_000 ? resetVal * 1_000 : Date.now() + resetVal * 1_000
        backoffMs = Math.max(resetMs - Date.now() + 500, retryAfterSecs * 1_000 || 10_000)
      } else {
        backoffMs = retryAfterSecs * 1_000 || 10_000
      }
      this.q.setRateLimited(backoffMs)
      this.q.updateFromHeaders(res.headers)
      const secs = Math.round(backoffMs / 1_000)
      console.warn(`[t212] Rate limited — queue paused for ${secs}s (${retries} retries left)`)
      hub.broadcast('toast', { message: `T212 rate limited — pausing ${secs}s`, level: 'warning' })
      await new Promise((r) => setTimeout(r, backoffMs))
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
    if (this._instrumentsInFlight) return this._instrumentsInFlight
    this._instrumentsInFlight = this.apiFetch<T212Instrument[]>('/equity/metadata/instruments')
      .then((data) => {
        this._instrumentCache = new Map(data.map((i) => [i.ticker, i]))
        return this._instrumentCache
      })
      .finally(() => {
        this._instrumentsInFlight = null
      })
    return this._instrumentsInFlight
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
    return this.apiFetch<PlaceOrderResult>(
      '/equity/orders/market',
      { method: 'POST', body: JSON.stringify({ ticker, quantity: signedQty }) },
      5
    )
  }

  async getOpenOrders(): Promise<T212Order[]> {
    return this.apiFetch<T212Order[]>('/equity/orders')
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.apiFetch<unknown>(`/equity/orders/${orderId}`, { method: 'DELETE' })
  }

  async getOrderHistory(): Promise<T212Order[]> {
    const MAX_PAGES = 20
    const all: T212Order[] = []
    let path = '/equity/history/orders?limit=50'
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.apiFetch<{ items: T212Order[]; nextPagePath?: string }>(path)
      all.push(...response.items)
      if (!response.nextPagePath || response.items.length === 0) break
      path = response.nextPagePath
    }
    return all
  }

  // ── Portfolio snapshot (with short-lived cache) ───────────────────────────

  invalidatePortfolioCache(): void {
    this._snapshotCache = null
    this._snapshotRefreshing = false
    this._snapshotInFlight = null
  }

  async getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
    const SNAPSHOT_TTL_MS = 60_000

    if (this._snapshotCache && Date.now() < this._snapshotCache.expiresAt) {
      return this._snapshotCache.data
    }

    // Stale-while-revalidate: return expired cache immediately, refresh in background.
    // Only blocks when there is no cache at all (cold start or post-order invalidation).
    if (this._snapshotCache) {
      if (!this._snapshotRefreshing) {
        this._snapshotRefreshing = true
        Promise.all([this.getPortfolio(), this.getCash()])
          .then(([positions, cash]) => {
            const data: PortfolioSnapshot = {
              cash,
              positions,
              totalValue: cash.free + cash.blocked + cash.invested + cash.ppl,
              totalPpl: cash.ppl,
            }
            this._snapshotCache = { data, expiresAt: Date.now() + SNAPSHOT_TTL_MS }
          })
          .catch(() => {})
          .finally(() => {
            this._snapshotRefreshing = false
          })
      }
      return this._snapshotCache.data
    }

    // No cache — deduplicate concurrent cold-start callers onto a single in-flight fetch.
    if (this._snapshotInFlight) return this._snapshotInFlight

    this._snapshotInFlight = Promise.all([this.getPortfolio(), this.getCash()])
      .then(([positions, cash]) => {
        const data: PortfolioSnapshot = {
          cash,
          positions,
          totalValue: cash.free + cash.blocked + cash.invested + cash.ppl,
          totalPpl: cash.ppl,
        }
        this._snapshotCache = { data, expiresAt: Date.now() + SNAPSHOT_TTL_MS }
        return data
      })
      .finally(() => {
        this._snapshotInFlight = null
      })

    return this._snapshotInFlight
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
