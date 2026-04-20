// FX helper: converts native instrument currency to EUR (the account currency).
//
// Strategy:
//   1. Per position, derive fxRate algebraically from T212's ppl / fxPpl fields:
//        pricePplEur   = ppl - fxPpl                    (price movement PnL in EUR)
//        pricePplNat   = (currentPrice - avgPrice) × qty (price movement PnL in native)
//        fxRate        = pricePplEur / pricePplNat      (EUR per 1 native unit)
//      This is exact and needs no external call, but fails when curP ≈ avgP
//      (denominator → 0) — e.g. a freshly opened position.
//   2. Fallback for any currency we couldn't derive: fetch from Frankfurter
//      (ECB rates, no API key) and cache in-memory. On network failure, reuse
//      any stale cached rate or fall back to 1.0 so we never hard-fail a cycle.
//
// Exported surface is intentionally small so call sites don't need to pick a
// strategy — they just hand us positions and get back a Map<currency, rate>.

interface FxCacheEntry {
  rate: number
  expiresAt: number
}

const FRANKFURTER_BASE = 'https://api.frankfurter.app'
const CACHE_TTL_MS = 15 * 60_000
const MIN_DERIVE_PPL_EUR = 0.2

const cache = new Map<string, FxCacheEntry>()
cache.set('EUR', { rate: 1, expiresAt: Number.POSITIVE_INFINITY })

export function deriveFxFromPosition(position: {
  currentPrice: number
  averagePrice: number
  quantity: number
  ppl: number
  fxPpl: number | null
}): number | null {
  const { currentPrice, averagePrice, quantity, ppl, fxPpl } = position
  const pricePplEur = ppl - (fxPpl ?? 0)
  const pricePplNat = (currentPrice - averagePrice) * quantity
  if (Math.abs(pricePplEur) < MIN_DERIVE_PPL_EUR) return null
  if (Math.abs(pricePplNat) < 1e-6) return null
  const rate = pricePplEur / pricePplNat
  if (!Number.isFinite(rate) || rate <= 0) return null
  return rate
}

async function fetchFxToEur(currency: string): Promise<number | null> {
  try {
    const res = await fetch(`${FRANKFURTER_BASE}/latest?from=${currency}&to=EUR`)
    if (!res.ok) throw new Error(`FX API ${res.status}`)
    const data = (await res.json()) as { rates?: Record<string, number> }
    const rate = data.rates?.EUR
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
    return rate
  } catch (err) {
    console.warn(`[fx] Failed to fetch EUR rate for ${currency}: ${(err as Error).message}`)
    return null
  }
}

export async function resolveFxRates(
  positions: ReadonlyArray<{
    currencyCode: string
    currentPrice: number
    averagePrice: number
    quantity: number
    ppl: number
    fxPpl: number | null
  }>
): Promise<Map<string, number>> {
  const rates = new Map<string, number>([['EUR', 1]])
  const now = Date.now()

  for (const pos of positions) {
    if (pos.currencyCode === 'EUR' || rates.has(pos.currencyCode)) continue
    const derived = deriveFxFromPosition(pos)
    if (derived !== null) {
      rates.set(pos.currencyCode, derived)
      cache.set(pos.currencyCode, { rate: derived, expiresAt: now + CACHE_TTL_MS })
    }
  }

  const needed = new Set(
    positions.map((p) => p.currencyCode).filter((c) => c !== 'EUR' && !rates.has(c))
  )
  for (const currency of needed) {
    const cached = cache.get(currency)
    if (cached && now < cached.expiresAt) {
      rates.set(currency, cached.rate)
      continue
    }
    const fetched = await fetchFxToEur(currency)
    if (fetched !== null) {
      cache.set(currency, { rate: fetched, expiresAt: now + CACHE_TTL_MS })
      rates.set(currency, fetched)
    } else if (cached) {
      rates.set(currency, cached.rate)
    } else {
      console.warn(`[fx] No rate available for ${currency} — using 1.0 (will overstate EUR value)`)
      rates.set(currency, 1)
    }
  }

  return rates
}

export function __clearFxCacheForTests(): void {
  cache.clear()
  cache.set('EUR', { rate: 1, expiresAt: Number.POSITIVE_INFINITY })
}
