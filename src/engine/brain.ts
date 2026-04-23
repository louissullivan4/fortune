import Anthropic from '@anthropic-ai/sdk'
import type { TickerSignal } from '../strategy/signals.js'
import type { PortfolioSnapshot } from '../api/trading212.js'
import type { Trading212Client } from '../api/trading212.js'
import type { RecentDecision } from '../analytics/journal.js'
import type { UserConfig } from '../types/user.js'
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

function formatPortfolio(snapshot: PortfolioSnapshot, userConfig: UserConfig): string {
  const lines = [
    `Cash: €${snapshot.cash.free.toFixed(2)} free / €${snapshot.cash.total.toFixed(2)} total`,
    `Total portfolio value: €${snapshot.totalValue.toFixed(2)}`,
    `All-time P&L: €${snapshot.totalPpl.toFixed(2)}`,
    '',
    'Positions:',
  ]
  const maxPositionValue = userConfig.maxBudgetEur * userConfig.maxPositionPct
  if (snapshot.positions.length === 0) {
    lines.push('  (none)')
  } else {
    for (const p of snapshot.positions) {
      const remaining = Math.max(0, maxPositionValue - p.costBasisEur)
      const nativeNote =
        p.currencyCode === 'EUR'
          ? `@ current €${p.currentPrice.toFixed(2)}`
          : `@ current ${p.currencyCode} ${p.currentPrice.toFixed(2)} (≈€${(p.currentPrice * p.fxRate).toFixed(2)})`
      lines.push(
        `  ${p.ticker}: ${p.quantity} shares ${nativeNote} | cost basis €${p.costBasisEur.toFixed(2)} | P&L: €${p.ppl.toFixed(2)} | remaining room: €${remaining.toFixed(2)} of €${maxPositionValue.toFixed(0)} cap`
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

function buildSystemPrompt(userConfig: UserConfig): string {
  return `You are an autonomous stock trading agent managing a small trading budget of €${userConfig.maxBudgetEur}. Your job is to decide ONE trading action per cycle: buy, sell, or hold.

HARD RULES — you must never violate these:
- Never spend more than €${userConfig.maxBudgetEur} total cash on a single buy order
- Never invest more than €${(userConfig.maxBudgetEur * userConfig.maxPositionPct).toFixed(0)} in a single stock — always use fractional shares to stay within this limit (e.g. if a stock costs €150 and your cap is €${(userConfig.maxBudgetEur * userConfig.maxPositionPct).toFixed(0)}, buy ${((userConfig.maxBudgetEur * userConfig.maxPositionPct) / 150).toFixed(2)} shares)
- Never buy a stock you already hold a position in — one position per ticker maximum
- Always keep at least €5 in cash as a buffer
- Hard exits (stop-loss ≥${(userConfig.stopLossPct * 100).toFixed(1)}% down, take-profit ≥${(userConfig.takeProfitPct * 100).toFixed(1)}% up, trailing stop) are handled automatically before you run — you do NOT need to issue these sells yourself
- Stagnant positions (held >${userConfig.stagnantTimeMinutes} minutes with <${(userConfig.stagnantRangePct * 100).toFixed(1)}% movement) will be listed for your review. You may SELL them to free capital for a better opportunity, or HOLD them if you see momentum building — your judgment takes precedence
- You may SELL a held position ONLY if there is at least one BUY or STRONG_BUY signal for a ticker you do NOT currently hold — never sell just to sit on cash
- If no better buy opportunity exists, HOLD the position regardless of how bearish its indicators look (the automatic stop-loss will protect you)
- Never sell a ticker and then immediately buy the same ticker — that is always a hold
- Only BUY stocks in the signal universe
- NOTE: Portfolio position prices may be in their local currency (USD/GBP), not EUR — ignore total portfolio value when deciding; focus on available EUR cash

STRATEGY:
- Holding cash is a valid outcome. Only buy when the setup is clearly good — a marginal BUY is worse than no trade
- Buy candidates: any STRONG_BUY signal, or a BUY signal with strong trend confirmation. Acceptable entries:
    • RSI 40–65 with SMA20 > SMA50 and EMA9 > EMA21 — do not refuse just because RSI is not deeply oversold
    • MACD bullish crossover (MACD line crosses above signal line) — high conviction momentum signal
    • Stochastic %K crossing above %D, especially from oversold zone (<30)
    • Price near lower Bollinger Band (%B ≤ 0.35) — mean-reversion opportunity with room to run
    • Multiple confluences (any 3 of the above) override a mildly elevated RSI
- Lone-BUY rule: if there is only ONE buy/strong_buy candidate in the universe this cycle, buy it ONLY when it satisfies BOTH (a) SMA20 > SMA50 (longer-term trend aligned up) AND (b) at least 3 bullish confluences from the list above. Otherwise HOLD — do not settle for a weak pick just because it is the only one on offer
- Reject any BUY where Stochastic %K > 85 — momentum is already at its peak and the upside is spent
- Sell candidates (early/signal-based): RSI >75 with price above upper Bollinger Band AND bearish Stochastic crossover — all three must align, not just one
- HOLD when no BUY/STRONG_BUY has reasonable technicals, or when the only available candidate fails the lone-BUY rule above

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "action": "buy" | "sell" | "hold",
  "ticker": "TICKER_SYMBOL" | null,
  "quantity": number | null,
  "estimatedPrice": number | null,
  "reasoning": "concise explanation of your decision"
}`
}

export async function decide(
  signals: TickerSignal[],
  snapshot: PortfolioSnapshot,
  recentDecisions: RecentDecision[],
  anthropicApiKey: string,
  t212: Trading212Client,
  userConfig: UserConfig,
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
      ? `\n## Stagnant Positions Awaiting Your Decision\nThese positions have moved less than ${(userConfig.stagnantRangePct * 100).toFixed(1)}% in over ${userConfig.stagnantTimeMinutes} minutes. SELL one to rotate capital, or HOLD if you see momentum building:\n${formatStagnantCandidates(stagnantCandidates)}\n`
      : ''

  const prompt = `## Current Portfolio
${formatPortfolio(snapshot, userConfig)}

## Market Signals (${signals.length} tickers analysed)
${formatSignals(actionableSignals.length > 0 ? actionableSignals : signals.slice(0, 10))}
${stagnantSection}
## Recent Decisions (last ${recentDecisions.length})
${formatRecentDecisions(recentDecisions)}

## Your Task
Analyse the above and decide on ONE action for this cycle. Prefer deploying cash over holding idle — the stop-loss and trailing stop protect capital automatically. Reply with JSON only.`

  const MODEL = 'claude-sonnet-4-6'
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(userConfig),
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

    if (parsed.action === 'sell' && parsed.ticker) {
      const hasBetterOpportunity = signals.some(
        (s) => (s.signal === 'buy' || s.signal === 'strong_buy') && s.ticker !== parsed.ticker
      )
      if (!hasBetterOpportunity) {
        parsed.action = 'hold'
        parsed.ticker = null
        parsed.quantity = null
        parsed.estimatedPrice = null
        parsed.reasoning +=
          ' [overridden to hold: no buy/strong_buy opportunity available for a different ticker — selling to hold cash is not permitted]'
      }
    }

    if (parsed.action === 'buy' && parsed.ticker) {
      const signal = signals.find((s) => s.ticker === parsed.ticker)
      const price = parsed.estimatedPrice ?? signal?.indicators.currentPrice ?? null
      if (price) {
        const instruments = await t212.getInstruments()
        const minQty = instruments.get(parsed.ticker)?.minTradeQuantity ?? 0.01
        const currency = instruments.get(parsed.ticker)?.currencyCode ?? 'EUR'
        const fxRate =
          currency === 'EUR'
            ? 1
            : (snapshot.positions.find((p) => p.currencyCode === currency)?.fxRate ?? 1)
        const maxQty = computeBuyQuantity(
          parsed.ticker,
          price,
          snapshot,
          userConfig,
          minQty,
          0.5,
          fxRate
        )
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
