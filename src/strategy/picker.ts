import type { PortfolioSnapshot } from '../api/trading212.js'
import type { RecentDecision } from '../analytics/journal.js'
import type { TickerSignal } from './signals.js'

export interface LastSellHint {
  ticker: string
  ms: number
}

export interface StagnantInfo {
  ticker: string
  minutesHeld: number
  pctFromEntry: number
}

export interface PickerConfig {
  /** Used in the stagnant-rotation reasoning string. */
  stagnantRangePct: number
}

export interface PickerInput {
  signals: TickerSignal[]
  snapshot: PortfolioSnapshot
  stagnant: StagnantInfo[]
  config: PickerConfig
  lastSell: LastSellHint | null
  nowMs: number
}

export interface PickerDecision {
  action: 'buy' | 'sell' | 'hold'
  ticker: string | null
  quantity: number | null
  estimatedPrice: number | null
  reasoning: string
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Deterministic decision engine. Encodes the hard rules from
 * `buildSystemPrompt()` in src/engine/brain.ts so the live engine and
 * backtester can share a single picker without an AI round-trip.
 */
export function pickDecision(input: PickerInput): PickerDecision {
  const { signals, snapshot, stagnant, config, lastSell, nowMs } = input

  const buyCandidates = signals.filter((s) => {
    if (s.signal !== 'buy' && s.signal !== 'strong_buy') return false
    if (snapshot.positions.some((p) => p.ticker === s.ticker)) return false
    const ind = s.indicators
    if (ind.stochK !== null && ind.stochK > 85) return false
    if (ind.sma20 === null || ind.sma50 === null || ind.sma20 <= ind.sma50) return false
    if (lastSell?.ticker === s.ticker && dayKey(lastSell.ms) === dayKey(nowMs)) return false
    if (s.bullishCount - s.bearishCount < 3) return false
    return true
  })

  if (
    stagnant.length > 0 &&
    buyCandidates.some((b) => !stagnant.find((s) => s.ticker === b.ticker))
  ) {
    const worst = [...stagnant].sort((a, b) => a.pctFromEntry - b.pctFromEntry)[0]
    const held = snapshot.positions.find((p) => p.ticker === worst.ticker)
    if (held) {
      return {
        action: 'sell',
        ticker: worst.ticker,
        quantity: held.quantity,
        estimatedPrice: held.currentPrice,
        reasoning: `Stagnant rotation: ${worst.ticker} held ${worst.minutesHeld}min with <${(config.stagnantRangePct * 100).toFixed(1)}% movement`,
      }
    }
  }

  if (buyCandidates.length === 0) {
    return {
      action: 'hold',
      ticker: null,
      quantity: null,
      estimatedPrice: null,
      reasoning: 'No qualifying buy candidates',
    }
  }

  if (buyCandidates.length === 1 && buyCandidates[0].bullishCount < 5) {
    return {
      action: 'hold',
      ticker: null,
      quantity: null,
      estimatedPrice: null,
      reasoning: `Lone-BUY ${buyCandidates[0].ticker} rejected (bullishCount=${buyCandidates[0].bullishCount} < 5)`,
    }
  }

  buyCandidates.sort((a, b) => {
    const da = a.bullishCount - a.bearishCount
    const db = b.bullishCount - b.bearishCount
    if (db !== da) return db - da
    if (a.signal !== b.signal) return a.signal === 'strong_buy' ? -1 : 1
    return a.ticker.localeCompare(b.ticker)
  })
  const pick = buyCandidates[0]
  const price = pick.indicators.currentPrice ?? 0
  return {
    action: 'buy',
    ticker: pick.ticker,
    quantity: null,
    estimatedPrice: price,
    reasoning: `${pick.signal} ${pick.ticker} (bull ${pick.bullishCount}/bear ${pick.bearishCount}): ${pick.reasons.slice(0, 2).join('; ')}`,
  }
}

/**
 * Find the most recent sell among the live-engine's recent-decisions log so
 * the picker can apply its same-day rebuy guard.
 */
export function lastSellFromRecentDecisions(decisions: RecentDecision[]): LastSellHint | null {
  for (const d of decisions) {
    if (d.action === 'sell' && d.ticker) {
      const ms = Date.parse(d.timestamp)
      if (!Number.isNaN(ms)) return { ticker: d.ticker, ms }
    }
  }
  return null
}
