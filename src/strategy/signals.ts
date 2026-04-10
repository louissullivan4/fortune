import type { TickerHistory } from '../api/marketdata.js'
import type { T212Position } from '../api/trading212.js'
import { computeIndicators, type TickerIndicators } from './indicators.js'

export type SignalType = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'

export interface TickerSignal {
  ticker: string
  signal: SignalType
  indicators: TickerIndicators
  reasons: string[]
  heldPosition: T212Position | null
}

function classifySignal(
  ind: TickerIndicators,
  held: T212Position | null
): { signal: SignalType; reasons: string[] } {
  const reasons: string[] = []
  let bullishCount = 0
  let bearishCount = 0

  // ── RSI ──────────────────────────────────────────────────────────────────
  if (ind.rsi14 !== null) {
    if (ind.rsi14 < 30) {
      reasons.push(`RSI oversold (${ind.rsi14.toFixed(1)})`)
      bullishCount += 3
    } else if (ind.rsi14 < 45) {
      reasons.push(`RSI low (${ind.rsi14.toFixed(1)})`)
      bullishCount += 2
    } else if (ind.rsi14 < 55) {
      reasons.push(`RSI neutral-low (${ind.rsi14.toFixed(1)})`)
      bullishCount += 1
    } else if (ind.rsi14 > 75) {
      reasons.push(`RSI overbought (${ind.rsi14.toFixed(1)})`)
      bearishCount += 3
    } else if (ind.rsi14 > 65) {
      reasons.push(`RSI high (${ind.rsi14.toFixed(1)})`)
      bearishCount += 2
    } else if (ind.rsi14 > 60) {
      reasons.push(`RSI approaching overbought (${ind.rsi14.toFixed(1)})`)
      bearishCount += 1
    }
  }

  // ── SMA 20/50 trend ───────────────────────────────────────────────────────
  if (ind.sma20 !== null && ind.sma50 !== null) {
    if (ind.sma20 > ind.sma50) {
      reasons.push('SMA20 > SMA50 (uptrend)')
      bullishCount += 2
    } else {
      reasons.push('SMA20 < SMA50 (downtrend)')
      bearishCount += 2
    }
  }

  // ── EMA 9/21 short-term momentum ─────────────────────────────────────────
  if (ind.ema9 !== null && ind.ema21 !== null) {
    const gap = ((ind.ema9 - ind.ema21) / ind.ema21) * 100
    if (ind.ema9 > ind.ema21) {
      reasons.push(`EMA9 > EMA21 (short-term momentum, gap ${gap.toFixed(2)}%)`)
      bullishCount += gap > 1 ? 3 : 2
    } else {
      reasons.push(`EMA9 < EMA21 (short-term downtrend, gap ${gap.toFixed(2)}%)`)
      bearishCount += Math.abs(gap) > 1 ? 2 : 1
    }
  }

  // ── MACD signal-line crossover + position ────────────────────────────────
  if (ind.macd !== null && ind.macdSignal !== null) {
    if (ind.macdBullCross) {
      reasons.push(
        `MACD bullish crossover (${ind.macd.toFixed(3)} > signal ${ind.macdSignal.toFixed(3)})`
      )
      bullishCount += 3
    } else if (ind.macdBearCross) {
      reasons.push(
        `MACD bearish crossover (${ind.macd.toFixed(3)} < signal ${ind.macdSignal.toFixed(3)})`
      )
      bearishCount += 3
    } else if (ind.macd > ind.macdSignal) {
      reasons.push(`MACD above signal (${ind.macd.toFixed(3)} vs ${ind.macdSignal.toFixed(3)})`)
      bullishCount += 1
    } else {
      reasons.push(`MACD below signal (${ind.macd.toFixed(3)} vs ${ind.macdSignal.toFixed(3)})`)
      bearishCount += 1
    }
    // Additional: overall MACD line direction
    if (ind.macd > 0) bullishCount += 1
    else bearishCount += 1
  }

  // ── Bollinger Bands — mean reversion buy/sell ────────────────────────────
  if (ind.bollingerPctB !== null) {
    const pctB = ind.bollingerPctB
    if (pctB < 0) {
      reasons.push(`Price below lower Bollinger Band (%B=${pctB.toFixed(2)}) — strong oversold`)
      bullishCount += 3
    } else if (pctB < 0.2) {
      reasons.push(`Price near lower Bollinger Band (%B=${pctB.toFixed(2)})`)
      bullishCount += 2
    } else if (pctB < 0.35) {
      reasons.push(`Price approaching lower Bollinger Band (%B=${pctB.toFixed(2)})`)
      bullishCount += 1
    } else if (pctB > 1) {
      reasons.push(`Price above upper Bollinger Band (%B=${pctB.toFixed(2)}) — strong overbought`)
      bearishCount += 3
    } else if (pctB > 0.8) {
      reasons.push(`Price near upper Bollinger Band (%B=${pctB.toFixed(2)})`)
      bearishCount += 2
    } else if (pctB > 0.65) {
      reasons.push(`Price approaching upper Bollinger Band (%B=${pctB.toFixed(2)})`)
      bearishCount += 1
    }
  }

  // ── Stochastic %K/%D crossover ───────────────────────────────────────────
  if (ind.stochK !== null && ind.stochD !== null) {
    const { stochK: k, stochD: d } = ind
    if (k < 20 && k > d) {
      reasons.push(
        `Stochastic bullish crossover from oversold (%K=${k.toFixed(1)}, %D=${d.toFixed(1)})`
      )
      bullishCount += 3
    } else if (k < 30 && k > d) {
      reasons.push(`Stochastic bullish cross in low zone (%K=${k.toFixed(1)}, %D=${d.toFixed(1)})`)
      bullishCount += 2
    } else if (k > 80 && k < d) {
      reasons.push(
        `Stochastic bearish crossover from overbought (%K=${k.toFixed(1)}, %D=${d.toFixed(1)})`
      )
      bearishCount += 3
    } else if (k > 70 && k < d) {
      reasons.push(`Stochastic bearish cross in high zone (%K=${k.toFixed(1)}, %D=${d.toFixed(1)})`)
      bearishCount += 2
    } else if (k > d) {
      reasons.push(`Stochastic %K above %D (${k.toFixed(1)} > ${d.toFixed(1)})`)
      bullishCount += 1
    } else {
      reasons.push(`Stochastic %K below %D (${k.toFixed(1)} < ${d.toFixed(1)})`)
      bearishCount += 1
    }
  }

  // ── Held position — stop-loss / take-profit ───────────────────────────────
  if (held) {
    const pctChange =
      held.averagePrice > 0
        ? ((held.currentPrice - held.averagePrice) / held.averagePrice) * 100
        : 0
    if (pctChange < -5) {
      reasons.push(`Stop-loss: position down ${pctChange.toFixed(1)}%`)
      bearishCount += 4
    } else if (pctChange > 2) {
      reasons.push(`Take-profit: position up ${pctChange.toFixed(1)}%`)
      bearishCount += 4
    }
  }

  let signal: SignalType
  if (bullishCount >= 7) signal = 'strong_buy'
  else if (bullishCount > bearishCount) signal = 'buy'
  else if (bearishCount >= 7) signal = 'strong_sell'
  else if (bearishCount > bullishCount) signal = 'sell'
  else signal = 'hold'

  return { signal, reasons }
}

export function generateSignals(
  universe: string[],
  histories: Map<string, TickerHistory>,
  positions: T212Position[]
): TickerSignal[] {
  const positionMap = new Map(positions.map((p) => [p.ticker, p]))
  const signals: TickerSignal[] = []

  for (const ticker of universe) {
    const history = histories.get(ticker)
    if (!history || history.bars.length < 30) {
      // Not enough data — skip
      continue
    }

    const closes = history.bars.map((b) => b.close)
    const indicators = computeIndicators(ticker, closes)
    const held = positionMap.get(ticker) ?? null
    const { signal, reasons } = classifySignal(indicators, held)

    signals.push({ ticker, signal, indicators, reasons, heldPosition: held })
  }

  // Also include held positions not in universe so we can decide to sell them
  for (const pos of positions) {
    if (!universe.includes(pos.ticker)) {
      signals.push({
        ticker: pos.ticker,
        signal: 'hold',
        indicators: computeIndicators(pos.ticker, [pos.currentPrice]),
        reasons: ['Held position outside universe — available for sell only'],
        heldPosition: pos,
      })
    }
  }

  return signals
}
