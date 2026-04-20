// Uses Yahoo Finance chart API directly (no package dependency on historical data)

export interface OHLCV {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TickerHistory {
  ticker: string
  bars: OHLCV[]
}

// T212 tickers use suffixes like _l (LSE). Yahoo uses .L for LSE, no suffix for US.
function toYahooSymbol(t212Ticker: string): string {
  if (t212Ticker.endsWith('_l')) return t212Ticker.slice(0, -2) + '.L'
  // Strip trailing exchange suffixes like _US_EQ or _EQ → keep base
  return t212Ticker.replace(/_[A-Z]+_[A-Z]+$/, '').replace(/_[A-Z]+$/, '')
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[]
      indicators: {
        quote: Array<{
          open: (number | null)[]
          high: (number | null)[]
          low: (number | null)[]
          close: (number | null)[]
          volume: (number | null)[]
        }>
      }
    }> | null
    error: { code: string; description: string } | null
  }
}

export async function getHistory(t212Ticker: string, days = 90): Promise<TickerHistory> {
  const symbol = toYahooSymbol(t212Ticker)
  const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo'
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) {
      console.warn(`[marketdata] HTTP ${res.status} for ${symbol}`)
      return { ticker: t212Ticker, bars: [] }
    }

    const json = (await res.json()) as YahooChartResponse
    const result = json.chart.result?.[0]
    if (!result) {
      if (json.chart.error) {
        console.warn(`[marketdata] Yahoo error for ${symbol}: ${json.chart.error.description}`)
      }
      return { ticker: t212Ticker, bars: [] }
    }

    const timestamps = result.timestamp
    if (!timestamps?.length) {
      return { ticker: t212Ticker, bars: [] }
    }
    const quote = result.indicators.quote[0]
    const bars: OHLCV[] = []

    for (let i = 0; i < timestamps.length; i++) {
      const close = quote.close[i]
      if (close === null) continue
      bars.push({
        date: new Date(timestamps[i] * 1000),
        open: quote.open[i] ?? close,
        high: quote.high[i] ?? close,
        low: quote.low[i] ?? close,
        close,
        volume: quote.volume[i] ?? 0,
      })
    }

    return { ticker: t212Ticker, bars }
  } catch (err) {
    console.warn(`[marketdata] Failed to fetch ${symbol}:`, (err as Error).message)
    return { ticker: t212Ticker, bars: [] }
  }
}

export async function getAllHistories(
  tickers: string[],
  days = 90
): Promise<Map<string, TickerHistory>> {
  const entries = await Promise.all(
    tickers.map(async (ticker) => [ticker, await getHistory(ticker, days)] as const)
  )
  return new Map(entries)
}

// ── Intraday live price ───────────────────────────────────────────────────
// Returns the most recent 5-minute bar close for the ticker from Yahoo Finance.
// Used to sanity-check signal prices (daily closes) against the live market
// before placing a buy order. Cached per ticker for 30 s.

const _liveCache = new Map<string, { price: number; expiresAt: number }>()
const LIVE_CACHE_TTL_MS = 30_000

export async function getLivePrice(t212Ticker: string): Promise<number | null> {
  const cached = _liveCache.get(t212Ticker)
  if (cached && Date.now() < cached.expiresAt) return cached.price

  const symbol = toYahooSymbol(t212Ticker)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const json = (await res.json()) as YahooChartResponse
    const result = json.chart.result?.[0]
    if (!result) return null
    const closes = result.indicators.quote[0].close
    const last = [...closes].reverse().find((c) => c !== null) ?? null
    if (last === null) return null
    _liveCache.set(t212Ticker, { price: last, expiresAt: Date.now() + LIVE_CACHE_TTL_MS })
    return last
  } catch {
    return null
  }
}
