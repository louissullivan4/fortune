// All functions take an array of closing prices, oldest first.

export function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

export function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const k = 2 / (period + 1)
  let value = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < prices.length; i++) {
    value = prices[i] * k + value * (1 - k)
  }
  return value
}

// Returns the full EMA time series (oldest first).
// result[0] = EMA at prices[period-1], result.length = prices.length - period + 1
function emaHistory(prices: number[], period: number): number[] {
  if (prices.length < period) return []
  const k = 2 / (period + 1)
  let value = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result: number[] = [value]
  for (let i = period; i < prices.length; i++) {
    value = prices[i] * k + value * (1 - k)
    result.push(value)
  }
  return result
}

export function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null
  const recent = prices.slice(-(period + 1))
  let gains = 0
  let losses = 0
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1]
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// Bollinger Bands. percentB: 0 = at lower band, 1 = at upper band, <0 = below lower band.
export function bollingerBands(
  prices: number[],
  period = 20,
  multiplier = 2
): { upper: number; middle: number; lower: number; percentB: number } | null {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  const middle = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period
  const std = Math.sqrt(variance)
  const upper = middle + multiplier * std
  const lower = middle - multiplier * std
  const current = prices[prices.length - 1]
  const percentB = upper !== lower ? (current - lower) / (upper - lower) : 0.5
  return { upper, middle, lower, percentB }
}

// MACD line, signal line (9-EMA of MACD), and histogram.
// Also returns previous bar values for crossover detection.
export function macdFull(
  prices: number[],
  fastP = 12,
  slowP = 26,
  signalP = 9
): {
  macd: number
  signal: number
  histogram: number
  prevMacd: number | null
  prevSignal: number | null
} | null {
  const fast = emaHistory(prices, fastP)
  const slow = emaHistory(prices, slowP)
  if (fast.length === 0 || slow.length === 0) return null

  // Align: fast[i + offset] and slow[i] both correspond to prices[slowP - 1 + i]
  const offset = slowP - fastP
  const macdLine: number[] = slow.map((s, i) => fast[i + offset] - s)

  if (macdLine.length < signalP) return null
  const signalLine = emaHistory(macdLine, signalP)
  if (signalLine.length === 0) return null

  const macd = macdLine[macdLine.length - 1]
  const signal = signalLine[signalLine.length - 1]
  const prevMacd = macdLine.length >= 2 ? macdLine[macdLine.length - 2] : null
  const prevSignal = signalLine.length >= 2 ? signalLine[signalLine.length - 2] : null

  return { macd, signal, histogram: macd - signal, prevMacd, prevSignal }
}

// Stochastic oscillator using close prices only (high = max close in window, low = min close).
// Returns %K (fast) and %D (3-period SMA of %K).
export function stochastic(
  prices: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number; d: number } | null {
  if (prices.length < kPeriod + dPeriod - 1) return null
  const kValues: number[] = []
  for (let i = kPeriod - 1; i < prices.length; i++) {
    const window = prices.slice(i - kPeriod + 1, i + 1)
    const highest = Math.max(...window)
    const lowest = Math.min(...window)
    kValues.push(highest !== lowest ? ((prices[i] - lowest) / (highest - lowest)) * 100 : 50)
  }
  if (kValues.length < dPeriod) return null
  const recentK = kValues.slice(-dPeriod)
  const d = recentK.reduce((a, b) => a + b, 0) / dPeriod
  return { k: kValues[kValues.length - 1], d }
}

export interface TickerIndicators {
  ticker: string
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  ema9: number | null
  ema12: number | null
  ema21: number | null
  ema26: number | null
  macd: number | null           // MACD line (ema12 - ema26)
  macdSignal: number | null     // 9-period EMA of MACD line
  macdHistogram: number | null  // macd - macdSignal
  macdBullCross: boolean | null // true if MACD just crossed above signal this bar
  macdBearCross: boolean | null // true if MACD just crossed below signal this bar
  bollingerUpper: number | null
  bollingerMiddle: number | null
  bollingerLower: number | null
  bollingerPctB: number | null  // 0=at lower band, 1=at upper band, <0=below
  stochK: number | null
  stochD: number | null
  currentPrice: number | null
  priceChange1d: number | null  // % change last close vs previous close
}

export function computeIndicators(ticker: string, closes: number[]): TickerIndicators {
  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : null
  const prevPrice = closes.length > 1 ? closes[closes.length - 2] : null
  const priceChange1d =
    currentPrice !== null && prevPrice !== null && prevPrice !== 0
      ? ((currentPrice - prevPrice) / prevPrice) * 100
      : null

  const rsi14 = rsi(closes, 14)
  const sma20Val = sma(closes, 20)
  const sma50Val = sma(closes, 50)
  const ema9Val = ema(closes, 9)
  const ema12Val = ema(closes, 12)
  const ema21Val = ema(closes, 21)
  const ema26Val = ema(closes, 26)

  const macdData = macdFull(closes)
  const bb = bollingerBands(closes)
  const stoch = stochastic(closes)

  let macdBullCross: boolean | null = null
  let macdBearCross: boolean | null = null
  if (macdData?.prevMacd !== null && macdData?.prevSignal !== null && macdData) {
    macdBullCross = macdData.prevMacd! < macdData.prevSignal! && macdData.macd > macdData.signal
    macdBearCross = macdData.prevMacd! > macdData.prevSignal! && macdData.macd < macdData.signal
  }

  return {
    ticker,
    rsi14,
    sma20: sma20Val,
    sma50: sma50Val,
    ema9: ema9Val,
    ema12: ema12Val,
    ema21: ema21Val,
    ema26: ema26Val,
    macd: macdData?.macd ?? null,
    macdSignal: macdData?.signal ?? null,
    macdHistogram: macdData?.histogram ?? null,
    macdBullCross,
    macdBearCross,
    bollingerUpper: bb?.upper ?? null,
    bollingerMiddle: bb?.middle ?? null,
    bollingerLower: bb?.lower ?? null,
    bollingerPctB: bb?.percentB ?? null,
    stochK: stoch?.k ?? null,
    stochD: stoch?.d ?? null,
    currentPrice,
    priceChange1d,
  }
}
