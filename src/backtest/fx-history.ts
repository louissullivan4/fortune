// Historical EUR-per-currency rates for deterministic backtests.
//
// Live trading converts native instrument prices to EUR via T212/Frankfurter at
// trade time. To estimate the live algorithm faithfully, the backtester must do
// the same with the rate that applied on each historical day — not a flat 1.0.
//
// We fetch one daily series per non-EUR currency from Frankfurter (ECB rates,
// no API key — the same provider src/api/fx.ts uses) and carry the last known
// rate forward across weekends/holidays. The fetch happens once, before the
// deterministic simulation, so the run itself stays offline and reproducible.

import type { FxRateResolver } from './simulator.js'

const FRANKFURTER_BASE = 'https://api.frankfurter.app'

interface DaySeries {
  /** Ascending YYYY-MM-DD. */
  days: string[]
  /** EUR per 1 native unit, aligned to `days`. */
  rates: number[]
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function fetchSeries(currency: string, start: Date, end: Date): Promise<DaySeries | null> {
  const url = `${FRANKFURTER_BASE}/${isoDay(start)}..${isoDay(end)}?from=${currency}&to=EUR`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`FX API ${res.status}`)
    const data = (await res.json()) as { rates?: Record<string, { EUR?: number }> }
    const entries = Object.entries(data.rates ?? {})
      .map(([day, r]) => [day, r?.EUR] as const)
      .filter(
        (x): x is readonly [string, number] =>
          typeof x[1] === 'number' && Number.isFinite(x[1]) && x[1] > 0
      )
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    if (entries.length === 0) return null
    return { days: entries.map((e) => e[0]), rates: entries.map((e) => e[1]) }
  } catch (err) {
    console.warn(`[backtest:fx] Failed to fetch ${currency}→EUR series: ${(err as Error).message}`)
    return null
  }
}

/**
 * Build a deterministic EUR-per-native resolver for the given currencies over
 * [start, end]. Returns 1.0 for EUR and for any currency whose series could not
 * be fetched (logged) so a network failure degrades gracefully rather than
 * aborting the run.
 */
export async function buildFxResolver(
  currencies: Iterable<string>,
  start: Date,
  end: Date
): Promise<FxRateResolver> {
  const series = new Map<string, DaySeries>()
  for (const currency of new Set(currencies)) {
    if (currency === 'EUR') continue
    const s = await fetchSeries(currency, start, end)
    if (s) {
      series.set(currency, s)
    } else {
      console.warn(
        `[backtest:fx] No ${currency} series — using 1.0 (sizing for ${currency} tickers will be unscaled)`
      )
    }
  }

  return (ms: number, currency: string): number => {
    if (currency === 'EUR') return 1
    const s = series.get(currency)
    if (!s) return 1
    const day = isoDay(new Date(ms))
    // Latest day <= target (carry-forward across weekends/holidays).
    let lo = 0
    let hi = s.days.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s.days[mid] <= day) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans === -1 ? s.rates[0] : s.rates[ans]
  }
}
