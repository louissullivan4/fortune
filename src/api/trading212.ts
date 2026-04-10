import { config } from '../config/index.js'
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

// ── Request queue ──────────────────────────────────────────────────────────
// Serialises all T212 API calls with a minimum gap between them.
// Prevents concurrent bursts from hitting the rate limit.

const MIN_INTERVAL_MS = 700 // stay comfortably under T212's ~1 req/s limit

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

const q = new RequestQueue()

// ── Auth & URL ─────────────────────────────────────────────────────────────

function authHeader(): string {
  const credentials = Buffer.from(
    `${config.trading212ApiKeyId}:${config.trading212ApiKeySecret}`
  ).toString('base64')
  return `Basic ${credentials}`
}

function baseUrl(): string {
  return config.trading212Mode === 'demo'
    ? 'https://demo.trading212.com/api/v0'
    : 'https://live.trading212.com/api/v0'
}

// Inner fetch — runs inside a queued job. Retries are done directly here (no
// re-enqueue) to avoid a deadlock: the queue is `busy` while a job runs, so
// re-enqueuing from inside a job would push to the back and never drain.
async function apiFetchInner<T>(
  path: string,
  init: RequestInit | undefined,
  retries: number
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
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
    return apiFetchInner<T>(path, init, retries - 1)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`T212 API error ${res.status}: ${body}`)
  }
  return res.json() as T
}

async function apiFetch<T>(path: string, init?: RequestInit, retries = 3): Promise<T> {
  return q.enqueue(() => apiFetchInner<T>(path, init, retries))
}

// ── Instrument cache ───────────────────────────────────────────────────────

let _instrumentCache: Map<string, T212Instrument> | null = null

export async function getInstruments(): Promise<Map<string, T212Instrument>> {
  if (_instrumentCache) return _instrumentCache
  const data = await apiFetch<T212Instrument[]>('/equity/metadata/instruments')
  _instrumentCache = new Map(data.map((i) => [i.ticker, i]))
  return _instrumentCache
}

// ── Portfolio & cash ───────────────────────────────────────────────────────

export async function getPortfolio(): Promise<T212Position[]> {
  return apiFetch<T212Position[]>('/equity/portfolio')
}

export async function getCash(): Promise<T212Cash> {
  return apiFetch<T212Cash>('/equity/account/cash')
}

// ── Orders ─────────────────────────────────────────────────────────────────

export async function placeMarketOrder(
  ticker: string,
  quantity: number,
  side: 'buy' | 'sell'
): Promise<PlaceOrderResult> {
  const signedQty = side === 'sell' ? -Math.abs(quantity) : Math.abs(quantity)
  return apiFetch<PlaceOrderResult>('/equity/orders/market', {
    method: 'POST',
    body: JSON.stringify({ ticker, quantity: signedQty }),
  })
}

export async function getOpenOrders(): Promise<T212Order[]> {
  return apiFetch<T212Order[]>('/equity/orders')
}

export async function cancelOrder(orderId: string): Promise<void> {
  await apiFetch<unknown>(`/equity/orders/${orderId}`, { method: 'DELETE' })
}

export async function getOrderHistory(): Promise<T212Order[]> {
  return apiFetch<T212Order[]>('/equity/history/orders?limit=50')
}

// ── Portfolio snapshot (with short-lived cache) ────────────────────────────
// Caches for 20s so rapid UI fetches don't stack on top of engine calls.
// Call invalidatePortfolioCache() after placing an order to force a fresh fetch.

export interface PortfolioSnapshot {
  cash: T212Cash
  positions: T212Position[]
  totalValue: number
  totalPpl: number
}

let _snapshotCache: { data: PortfolioSnapshot; expiresAt: number } | null = null
const SNAPSHOT_TTL_MS = 20_000

export function invalidatePortfolioCache(): void {
  _snapshotCache = null
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  if (_snapshotCache && Date.now() < _snapshotCache.expiresAt) {
    return _snapshotCache.data
  }
  // Fetch sequentially through the queue (not Promise.all) to avoid two
  // back-to-back requests landing in the same rate-limit window.
  const positions = await getPortfolio()
  const cash = await getCash()
  const data: PortfolioSnapshot = {
    cash,
    positions,
    totalValue: cash.free + cash.invested + cash.ppl,
    totalPpl: cash.ppl,
  }
  _snapshotCache = { data, expiresAt: Date.now() + SNAPSHOT_TTL_MS }
  return data
}
