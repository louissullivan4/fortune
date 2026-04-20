import Anthropic from '@anthropic-ai/sdk'
import type { TickerSignal } from '../strategy/signals.js'
import type { PortfolioSnapshot } from '../api/trading212.js'
import type { Trading212Client } from '../api/trading212.js'
import type { RecentDecision } from '../analytics/journal.js'
import type { MarketConfig } from '../types/user.js'
import { computeBuyQuantity } from './riskmanager.js'

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'
  ticker: string | null
  quantity: number | null
  estimatedPrice: number | null
  reasoning: string
}

// claude-sonnet-4-6 pricing (USD per million tokens, April 2026)
const PRICE_INPUT_PER_MTOK = 3.0
const PRICE_OUTPUT_PER_MTOK = 15.0

export interface UsageSummary {
  model: string
  inputTokens: number
  outputTokens: number
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
}

export interface DecideResult {
  decision: TradeDecision
  usage: UsageSummary
}

export interface StagnantInfo {
  ticker: string
  minutesHeld: number
  pctFromEntry: number
}

function formatSignals(signals: TickerSignal[]): string {
  return signals
    .map((s) => {
      const ind = s.indicators
      const held = s.heldPosition
        ? ` [HELD: ${s.heldPosition.quantity} @ avg €${s.heldPosition.averagePrice.toFixed(2)}, P&L: ${s.heldPosition.ppl.toFixed(2)}]`
        : ''
      return [
        `${s.ticker} → ${s.signal.toUpperCase()}${held}`,
        `  Price: ${ind.currentPrice?.toFixed(2) ?? 'n/a'} | RSI(14): ${ind.rsi14?.toFixed(1) ?? 'n/a'} | SMA20: ${ind.sma20?.toFixed(2) ?? 'n/a'} | SMA50: ${ind.sma50?.toFixed(2) ?? 'n/a'}`,
        `  EMA9: ${ind.ema9?.toFixed(2) ?? 'n/a'} | EMA21: ${ind.ema21?.toFixed(2) ?? 'n/a'} | MACD: ${ind.macd?.toFixed(3) ?? 'n/a'} | MACD Signal: ${ind.macdSignal?.toFixed(3) ?? 'n/a'} | Hist: ${ind.macdHistogram?.toFixed(3) ?? 'n/a'}`,
        `  BB %B: ${ind.bollingerPctB?.toFixed(2) ?? 'n/a'} (L:${ind.bollingerLower?.toFixed(2) ?? 'n/a'} M:${ind.bollingerMiddle?.toFixed(2) ?? 'n/a'} U:${ind.bollingerUpper?.toFixed(2) ?? 'n/a'}) | Stoch %K: ${ind.stochK?.toFixed(1) ?? 'n/a'} %D: ${ind.stochD?.toFixed(1) ?? 'n/a'}`,
        `  Reasons: ${s.reasons.join('; ')}`,
      ].join('\n')
    })
    .join('\n\n')
}

function formatPortfolio(snapshot: PortfolioSnapshot, market: MarketConfig): string {
  const lines = [
    `Cash available on ${market.exchange}: €${snapshot.cash.free.toFixed(2)}`,
    `Total value of ${market.exchange} positions: €${snapshot.totalValue.toFixed(2)}`,
    `${market.exchange} P&L: €${snapshot.totalPpl.toFixed(2)}`,
    '',
    `Positions on ${market.exchange}:`,
  ]
  const maxPositionValue = market.maxBudgetEur * market.maxPositionPct
  if (snapshot.positions.length === 0) {
    lines.push('  (none)')
  } else {
    for (const p of snapshot.positions) {
      const costBasis = p.averagePrice * p.quantity
      const remaining = Math.max(0, maxPositionValue - costBasis)
      lines.push(
        `  ${p.ticker}: ${p.quantity} shares @ current €${p.currentPrice.toFixed(2)} | cost basis €${costBasis.toFixed(2)} | P&L: €${p.ppl.toFixed(2)} | remaining room: €${remaining.toFixed(2)} of €${maxPositionValue.toFixed(0)} cap`
      )
    }
  }
  return lines.join('\n')
}

function formatStagnantCandidates(candidates: StagnantInfo[]): string {
  return candidates
    .map((c) => {
      const direction = c.pctFromEntry >= 0 ? '+' : ''
      return `  ${c.ticker}: held ${c.minutesHeld} min, currently ${direction}${c.pctFromEntry.toFixed(2)}% from entry`
    })
    .join('\n')
}

function formatRecentDecisions(decisions: RecentDecision[]): string {
  if (decisions.length === 0) return '(none yet)'
  return decisions
    .map(
      (d) =>
        `[${d.timestamp}] ${d.action.toUpperCase()} ${d.ticker ?? ''} ${d.quantity ?? ''} — ${d.reasoning.slice(0, 120)}`
    )
    .join('\n')
}

function buildSystemPrompt(market: MarketConfig): string {
  const fxNote =
    market.exchange === 'NYSE'
      ? 'NYSE equities are USD-denominated — T212 charges ~0.15% FX each way on EUR↔USD conversion'
      : 'XETRA equities are EUR-native — no FX fee on entry or exit'
  return `You are an autonomous stock trading agent trading exclusively on ${market.exchange}. Your budget on THIS market is €${market.maxBudgetEur}. You manage this sandbox independently — another engine instance runs any other enabled markets with their own separate budget. Do not consider opportunities outside ${market.exchange}.

Your job is to decide ONE trading action per cycle: buy, sell, or hold.

HARD RULES — you must never violate these:
- Never spend more than €${market.maxBudgetEur} total cash on a single buy order (this market's budget)
- Never invest more than €${(market.maxBudgetEur * market.maxPositionPct).toFixed(0)} in a single stock — use fractional shares to stay within the cap
- Never buy a stock you already hold a position in — one position per ticker maximum
- Always keep at least €5 in cash as a buffer
- Hard exits (stop-loss ≥${(market.stopLossPct * 100).toFixed(1)}% down, take-profit ≥${(market.takeProfitPct * 100).toFixed(1)}% up, trailing stop) are handled automatically before you run — do NOT issue these sells yourself
- Stagnant positions (held >${market.stagnantTimeMinutes} minutes with <${(market.stagnantRangePct * 100).toFixed(1)}% movement) will be listed for your review — SELL them to free capital or HOLD if you see momentum building
- You may SELL a held position if technical signals have turned bearish, even if the automatic stop hasn't triggered yet
- Only BUY stocks in the provided ${market.exchange} signal universe
- FX: ${fxNote}

STRATEGY:
- The budget exists to be deployed — prefer buying over sitting on idle cash
- Buy candidates: any STRONG_BUY, or a BUY with strong trend confirmation. Acceptable entries:
    • RSI 40–65 with SMA20 > SMA50 and EMA9 > EMA21
    • MACD bullish crossover
    • Stochastic %K crossing above %D, especially from oversold
    • Price near lower Bollinger Band (%B ≤ 0.35) — mean-reversion
    • Multiple confluences (3+) override mildly elevated RSI
- Do NOT refuse a STRONG_BUY just because RSI is above 50 — the signal system already penalises overbought conditions
- Sell candidates (early): RSI >75 with price above upper Bollinger Band AND bearish Stochastic crossover — all three must align
- HOLD only when the ${market.exchange} universe is genuinely bearish with no reasonable BUY/STRONG_BUY

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "action": "buy" | "sell" | "hold",
  "ticker": "TICKER_SYMBOL" | null,
  "quantity": number | null,
  "estimatedPrice": number | null,
  "reasoning": "concise explanation"
}`
}

export async function decide(
  signals: TickerSignal[],
  snapshot: PortfolioSnapshot,
  recentDecisions: RecentDecision[],
  anthropicApiKey: string,
  t212: Trading212Client,
  market: MarketConfig,
  stagnantCandidates: StagnantInfo[] = []
): Promise<DecideResult> {
  const client = new Anthropic({ apiKey: anthropicApiKey })

  const actionableSignals = signals.filter(
    (s) =>
      s.signal === 'buy' ||
      s.signal === 'strong_buy' ||
      s.signal === 'sell' ||
      s.signal === 'strong_sell' ||
      s.heldPosition
  )

  const stagnantSection =
    stagnantCandidates.length > 0
      ? `\n## Stagnant Positions Awaiting Your Decision\nThese positions have moved less than ${(market.stagnantRangePct * 100).toFixed(1)}% in over ${market.stagnantTimeMinutes} minutes. SELL to rotate capital on ${market.exchange}, or HOLD if you see momentum:\n${formatStagnantCandidates(stagnantCandidates)}\n`
      : ''

  const prompt = `## Current ${market.exchange} Portfolio
${formatPortfolio(snapshot, market)}

## ${market.exchange} Market Signals (${signals.length} tickers analysed)
${formatSignals(actionableSignals.length > 0 ? actionableSignals : signals.slice(0, 10))}
${stagnantSection}
## Recent Decisions on ${market.exchange} (last ${recentDecisions.length})
${formatRecentDecisions(recentDecisions)}

## Your Task
Decide ONE action for this cycle on ${market.exchange}. Prefer deploying cash over holding idle — the stop-loss and trailing stop protect capital automatically. Reply with JSON only.`

  const MODEL = 'claude-sonnet-4-6'
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(market),
    messages: [{ role: 'user', content: prompt }],
  })

  const inputTokens = message.usage.input_tokens
  const outputTokens = message.usage.output_tokens
  const inputCostUsd = (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK
  const outputCostUsd = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  const usage: UsageSummary = {
    model: MODEL,
    inputTokens,
    outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  }

  const text = message.content.find((b) => b.type === 'text')?.text ?? ''

  try {
    const candidates: string[] = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue
      let depth = 0
      let j = i
      while (j < text.length) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') {
          depth--
          if (depth === 0) break
        }
        j++
      }
      if (depth === 0) candidates.push(text.slice(i, j + 1))
    }
    const jsonMatch = candidates.at(-1)
    if (!jsonMatch) throw new Error('No JSON object found in response')
    const parsed = JSON.parse(jsonMatch) as {
      action: 'buy' | 'sell' | 'hold'
      ticker: string | null
      quantity: number | null
      estimatedPrice: number | null
      reasoning: string
    }

    if (parsed.action === 'buy' && parsed.ticker) {
      const signal = signals.find((s) => s.ticker === parsed.ticker)
      const price = parsed.estimatedPrice ?? signal?.indicators.currentPrice ?? null
      if (price) {
        const instruments = await t212.getInstruments()
        const minQty = instruments.get(parsed.ticker)?.minTradeQuantity ?? 0.01
        const maxQty = computeBuyQuantity(parsed.ticker, price, snapshot, market, minQty)
        if (maxQty <= 0) {
          parsed.action = 'hold'
          parsed.ticker = null
          parsed.quantity = null
          parsed.estimatedPrice = null
          parsed.reasoning += ' [overridden to hold: position cap reached or insufficient cash]'
        } else {
          parsed.quantity =
            parsed.quantity && parsed.quantity > 0 ? Math.min(parsed.quantity, maxQty) : maxQty
          parsed.estimatedPrice = price
        }
      }
    }

    return { decision: parsed, usage }
  } catch {
    console.error('[brain] Failed to parse Claude response:', text)
    return {
      decision: {
        action: 'hold',
        ticker: null,
        quantity: null,
        estimatedPrice: null,
        reasoning: `Parse error — defaulting to hold. Raw response: ${text.slice(0, 200)}`,
      },
      usage,
    }
  }
}
