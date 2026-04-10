import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config/index.js'
import type { TickerSignal } from '../strategy/signals.js'
import type { PortfolioSnapshot } from '../api/trading212.js'
import type { RecentDecision } from '../analytics/journal.js'
import { computeBuyQuantity } from './riskmanager.js'
import { getInstruments } from '../api/trading212.js'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

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

function formatPortfolio(snapshot: PortfolioSnapshot): string {
  const lines = [
    `Cash: €${snapshot.cash.free.toFixed(2)} free / €${snapshot.cash.total.toFixed(2)} total`,
    `Total portfolio value: €${snapshot.totalValue.toFixed(2)}`,
    `All-time P&L: €${snapshot.totalPpl.toFixed(2)}`,
    '',
    'Positions:',
  ]
  const maxPositionValue = config.maxBudgetEur * config.maxPositionPct
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

function formatRecentDecisions(decisions: RecentDecision[]): string {
  if (decisions.length === 0) return '(none yet)'
  return decisions
    .map(
      (d) =>
        `[${d.timestamp}] ${d.action.toUpperCase()} ${d.ticker ?? ''} ${d.quantity ?? ''} — ${d.reasoning.slice(0, 120)}`
    )
    .join('\n')
}

const SYSTEM_PROMPT = `You are an autonomous stock trading agent managing a small trading budget of €${config.maxBudgetEur}. Your job is to decide ONE trading action per cycle: buy, sell, or hold.

HARD RULES — you must never violate these:
- Never spend more than €${config.maxBudgetEur} total cash on a single buy order
- Never invest more than €${(config.maxBudgetEur * config.maxPositionPct).toFixed(0)} in a single stock
- Never buy a stock you already hold a position in — one position per ticker maximum
- Always keep at least €5 in cash as a buffer
- Hard exits (stop-loss ≥${(config.stopLossPct * 100).toFixed(1)}% down, take-profit ≥${(config.takeProfitPct * 100).toFixed(1)}% up, trailing stop 3% from peak once +1.5% up) are handled automatically before you run — you do NOT need to issue these sells yourself
- Stagnant exits (position held >${config.stagnantTimeMinutes} minutes with <${(config.stagnantRangePct * 100).toFixed(1)}% movement at break-even or better, when a stronger opportunity exists) are also handled automatically — you do NOT need to manage these
- You may SELL a held position if technical signals have turned bearish, even if the automatic stop hasn't triggered yet
- Only BUY stocks in the signal universe
- You are running in ${config.trading212Mode.toUpperCase()} mode
- NOTE: Portfolio position prices may be in their local currency (USD/GBP), not EUR — ignore total portfolio value when deciding; focus on available EUR cash

STRATEGY:
- Be aggressive with the small budget — it exists to be deployed, not sit idle
- Buy candidates: any BUY or STRONG_BUY signal. Strongest confluences:
    • MACD bullish crossover (MACD line crosses above signal line)
    • Stochastic %K crossing above %D from oversold zone (<20–30)
    • Price at or below lower Bollinger Band (%B ≤ 0.2) indicating mean-reversion opportunity
    • EMA9 > EMA21 confirming short-term momentum, especially when SMA20 > SMA50
    • RSI < 45 showing room to run without being overbought
- Sell candidates (early/signal-based): overbought RSI >75, MACD bearish crossover with bearish Stochastic, or price above upper Bollinger Band — the automatic trailing stop handles exits when price reverses from peak
- HOLD only when all signals are genuinely bearish or there is truly nothing actionable
- Prefer buying something over sitting on cash — the budget is €${config.maxBudgetEur}, use it

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "action": "buy" | "sell" | "hold",
  "ticker": "TICKER_SYMBOL" | null,
  "quantity": number | null,
  "estimatedPrice": number | null,
  "reasoning": "concise explanation of your decision"
}`

export async function decide(
  signals: TickerSignal[],
  snapshot: PortfolioSnapshot,
  recentDecisions: RecentDecision[]
): Promise<DecideResult> {
  // Pre-compute suggested buy quantities and attach to relevant signals
  const actionableSignals = signals.filter(
    (s) =>
      s.signal === 'buy' ||
      s.signal === 'strong_buy' ||
      s.signal === 'sell' ||
      s.signal === 'strong_sell' ||
      s.heldPosition
  )

  const prompt = `## Current Portfolio
${formatPortfolio(snapshot)}

## Market Signals (${signals.length} tickers analysed)
${formatSignals(actionableSignals.length > 0 ? actionableSignals : signals.slice(0, 10))}

## Recent Decisions (last ${recentDecisions.length})
${formatRecentDecisions(recentDecisions)}

## Your Task
Analyse the above and decide on ONE action for this cycle. Be conservative — protecting capital matters more than maximising gains. Reply with JSON only.`

  const MODEL = 'claude-sonnet-4-6'
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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
    // Find all top-level JSON objects in the response and take the last one.
    // Claude sometimes writes a draft hold then reconsiders — the final object is correct.
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

    // For buys, always clamp quantity to what the risk manager will allow.
    // Claude's arithmetic is unreliable — computeBuyQuantity is authoritative.
    if (parsed.action === 'buy' && parsed.ticker) {
      const signal = signals.find((s) => s.ticker === parsed.ticker)
      const price = parsed.estimatedPrice ?? signal?.indicators.currentPrice ?? null
      if (price) {
        const instruments = await getInstruments()
        const minQty = instruments.get(parsed.ticker)?.minTradeQuantity ?? 0.01
        const maxQty = computeBuyQuantity(parsed.ticker, price, snapshot, minQty)
        if (maxQty <= 0) {
          // No room left — override to hold
          parsed.action = 'hold'
          parsed.ticker = null
          parsed.quantity = null
          parsed.estimatedPrice = null
          parsed.reasoning += ' [overridden to hold: position cap reached or insufficient cash]'
        } else {
          // Cap Claude's quantity to the safe maximum
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
