import { config } from '../config/index.js'
import { getPortfolioSnapshot, placeMarketOrder, getInstruments, invalidatePortfolioCache, type PortfolioSnapshot } from '../api/trading212.js'
import { getAllHistories } from '../api/marketdata.js'
import { generateSignals } from '../strategy/signals.js'
import { validateOrder } from './riskmanager.js'
import { decide } from './brain.js'
import {
  logDecision,
  logOrder,
  logAiUsage,
  upsertDailySnapshot,
  updateDailyClose,
  getDailyOpenValue,
  getRecentDecisions,
  openAiPosition,
  closeAiPosition,
  getOpenAiPositions,
  reconcileAiPositions,
  updateHighWaterMark,
} from '../analytics/journal.js'

// ── Market hours ───────────────────────────────────────────────────────────

interface MarketWindow {
  name: string
  openUtcHour: number
  openUtcMin: number
  closeUtcHour: number
  closeUtcMin: number
}

const MARKETS: MarketWindow[] = [
  // LSE (approximate — doesn't account for DST perfectly, but close enough)
  { name: 'LSE', openUtcHour: 8, openUtcMin: 0, closeUtcHour: 16, closeUtcMin: 30 },
  // NYSE / NASDAQ
  { name: 'US', openUtcHour: 14, openUtcMin: 30, closeUtcHour: 21, closeUtcMin: 0 },
]

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

function toMinutes(hour: number, min: number): number {
  return hour * 60 + min
}

export function isMarketOpen(): boolean {
  const now = new Date()
  if (!isWeekday(now)) return false
  const currentMins = toMinutes(now.getUTCHours(), now.getUTCMinutes())
  return MARKETS.some((m) => {
    const open = toMinutes(m.openUtcHour, m.openUtcMin)
    const close = toMinutes(m.closeUtcHour, m.closeUtcMin)
    return currentMins >= open && currentMins < close
  })
}

export function nextOpenMs(): number {
  const now = new Date()
  const todayMins = toMinutes(now.getUTCHours(), now.getUTCMinutes())

  // Find earliest market open today that hasn't passed yet
  for (const m of MARKETS) {
    const open = toMinutes(m.openUtcHour, m.openUtcMin)
    if (open > todayMins) {
      const msUntil = (open - todayMins) * 60 * 1000
      return msUntil
    }
  }

  // All markets closed for today — wait until LSE open tomorrow (or Monday)
  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  while (!isWeekday(tomorrow)) {
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  }
  tomorrow.setUTCHours(MARKETS[0].openUtcHour, MARKETS[0].openUtcMin, 0, 0)
  return tomorrow.getTime() - now.getTime()
}

// ── Session cash tracking ──────────────────────────────────────────────────
// T212 processes market orders async, so cash.free doesn't drop immediately.
// We track committed spend in memory so the risk manager sees accurate available cash.

let sessionCashCommitted = 0
let lastKnownFreeCash: number | null = null

function adjustedSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  // If T212's actual free cash has dropped since we last saw it, orders have settled —
  // reduce our committed tracker by however much T212 deducted
  if (lastKnownFreeCash !== null && snapshot.cash.free < lastKnownFreeCash) {
    const settled = lastKnownFreeCash - snapshot.cash.free
    sessionCashCommitted = Math.max(0, sessionCashCommitted - settled)
  }
  lastKnownFreeCash = snapshot.cash.free

  const effectiveFree = Math.max(0, snapshot.cash.free - sessionCashCommitted)
  return { ...snapshot, cash: { ...snapshot.cash, free: effectiveFree } }
}

// ── Trailing stop / hard stop-loss check ──────────────────────────────────
// Runs before Claude — uses the bot's own entry prices, not T212's blended average.
//
// Strategy:
//   • Hard stop-loss: exit if position is down ≥ STOP_LOSS_PCT from entry (capital protection)
//   • Trailing stop: once a position reaches TRAIL_ACTIVATION_PCT profit, track the highest
//     price seen (high-water mark). Exit if price falls ≥ TRAIL_STOP_PCT from the peak.
//     This lets winners run much further than a fixed 2% take-profit.
//
// All open positions are checked and exited in the same cycle — no "one exit per cycle" limit.

const STOP_LOSS_PCT         = 5.0   // hard stop: entry down 5% → exit
const TRAIL_ACTIVATION_PCT  = 1.5   // trailing stop activates once position is +1.5% from entry
const TRAIL_STOP_PCT        = 3.0   // trail 3% below the high-water mark

async function checkHardExits(snapshot: PortfolioSnapshot, timestamp: string): Promise<number> {
  const openPositions = getOpenAiPositions()
  if (openPositions.length === 0) return 0

  let exitsPlaced = 0

  for (const pos of openPositions) {
    if (!pos.entryPrice) continue
    const live = snapshot.positions.find((p) => p.ticker === pos.ticker)
    if (!live) continue

    // Update high-water mark with current price
    updateHighWaterMark(pos.ticker, live.currentPrice)
    const hwm = Math.max(pos.highWaterMark ?? pos.entryPrice, live.currentPrice)

    const pctFromEntry = ((live.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
    const pctFromPeak  = ((live.currentPrice - hwm) / hwm) * 100

    const isStopLoss      = pctFromEntry <= -STOP_LOSS_PCT
    const trailActivated  = pctFromEntry >= TRAIL_ACTIVATION_PCT || (pos.highWaterMark ?? 0) >= pos.entryPrice * (1 + TRAIL_ACTIVATION_PCT / 100)
    const isTrailingStop  = trailActivated && pctFromPeak <= -TRAIL_STOP_PCT

    if (!isStopLoss && !isTrailingStop) continue

    const reason = isStopLoss
      ? `Stop-loss: down ${pctFromEntry.toFixed(2)}% from entry €${pos.entryPrice.toFixed(2)}`
      : `Trailing stop: down ${Math.abs(pctFromPeak).toFixed(2)}% from peak €${hwm.toFixed(2)} (entry €${pos.entryPrice.toFixed(2)}, +${pctFromEntry.toFixed(2)}%)`

    console.log(`[scheduler] Hard exit triggered — ${pos.ticker}: ${reason}`)

    const sellQty = live.quantity

    const risk = await validateOrder(
      { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: live.currentPrice },
      snapshot,
      getDailyOpenValue(timestamp.slice(0, 10)) ?? snapshot.totalValue
    )

    if (!risk.allowed) {
      console.log(`[scheduler] Risk blocked hard exit: ${risk.reason}`)
      continue
    }

    const decisionId = logDecision({
      timestamp, action: 'sell', ticker: pos.ticker, quantity: sellQty,
      estimatedPrice: live.currentPrice, reasoning: reason,
      signalsJson: '[]',
      portfolioJson: JSON.stringify({ totalValue: snapshot.totalValue, cash: snapshot.cash.free }),
    })

    try {
      const order = await placeMarketOrder(pos.ticker, sellQty, 'sell')
      closeAiPosition(pos.ticker, live.currentPrice, timestamp)
      invalidatePortfolioCache()
      console.log(`[scheduler] Hard exit order placed: ${order.id} (${order.status})`)
      logOrder({ decisionId, t212OrderId: order.id, status: order.status, fillPrice: live.currentPrice, fillQuantity: sellQty, timestamp })
      exitsPlaced++
    } catch (err) {
      console.error(`[scheduler] Hard exit order failed: ${(err as Error).message}`)
      logOrder({ decisionId, t212OrderId: null, status: `error: ${(err as Error).message}`, fillPrice: null, fillQuantity: null, timestamp })
    }
  }
  return exitsPlaced
}

// ── Single trading cycle ───────────────────────────────────────────────────

export async function runCycle(): Promise<void> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timestamp = now.toISOString()

  console.log(`\n[scheduler] ${timestamp} — running cycle`)

  // 1. Fetch portfolio snapshot
  const snapshot = adjustedSnapshot(await getPortfolioSnapshot())
  const pendingNote = sessionCashCommitted > 0 ? ` (€${sessionCashCommitted.toFixed(2)} pending settlement)` : ''
  console.log(`[scheduler] Portfolio: €${snapshot.totalValue.toFixed(2)} total, €${snapshot.cash.free.toFixed(2)} free cash${pendingNote}`)

  // 2. Hard exit check — trailing stop / stop-loss using bot's own entry prices.
  // All qualifying positions are exited in one pass. After exits, we still proceed to
  // the AI decision so freed-up cash can be redeployed in the same cycle.
  const exitsPlaced = await checkHardExits(snapshot, timestamp)
  if (exitsPlaced > 0) {
    // Re-fetch snapshot so the AI sees the updated cash balance after exits
    const freshSnapshot = adjustedSnapshot(await getPortfolioSnapshot())
    Object.assign(snapshot, freshSnapshot)
  }

  const dailyOpenValue = getDailyOpenValue(dateStr) ?? snapshot.totalValue

  // 4. Daily loss check — if we're already down >10%, halt
  const drawdown = (dailyOpenValue - snapshot.totalValue) / dailyOpenValue
  if (drawdown > config.dailyLossLimitPct) {
    console.log(`[scheduler] Daily loss limit hit (${(drawdown * 100).toFixed(1)}%) — halting for today`)
    return
  }

  // 4. Fetch market data
  console.log(`[scheduler] Fetching price history for ${config.tradeUniverse.length} tickers...`)
  const histories = await getAllHistories(config.tradeUniverse, 90)

  // 5. Generate signals — only pass positions the bot itself opened so it never
  //    tries to sell manually-held positions that aren't part of its tracked portfolio.
  const botTickers = new Set(getOpenAiPositions().map((p) => p.ticker))
  const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
  const signals = generateSignals(config.tradeUniverse, histories, botPositions)
  const actionable = signals.filter((s) => s.signal !== 'hold').length
  console.log(`[scheduler] Signals: ${signals.length} tickers, ${actionable} actionable`)

  // Compute AI portfolio value: free cash + current market value of bot-managed positions.
  // This is the metric tracked by the charts — it reflects the bot's €${config.maxBudgetEur}
  // budget performance, not the user's entire T212 account.
  const aiPositionsValue = botPositions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
  const aiValue = snapshot.cash.free + aiPositionsValue

  // 3. Record daily open snapshot (now that aiValue is available)
  upsertDailySnapshot(dateStr, snapshot.totalValue, aiValue)

  // 6. Ask Claude for a decision
  const recentDecisions = getRecentDecisions(5)
  console.log('[scheduler] Asking Claude for decision...')
  const botSnapshot = { ...snapshot, positions: botPositions }
  const { decision, usage } = await decide(signals, botSnapshot, recentDecisions)
  console.log(`[scheduler] Claude decision: ${decision.action.toUpperCase()} ${decision.ticker ?? ''}`)
  console.log(`[scheduler] Reasoning: ${decision.reasoning}`)
  console.log(`[scheduler] Token usage: ${usage.inputTokens} in / ${usage.outputTokens} out — $${usage.totalCostUsd.toFixed(6)}`)

  // 7. Log the decision and AI usage
  const decisionId = logDecision({
    timestamp,
    action: decision.action,
    ticker: decision.ticker,
    quantity: decision.quantity,
    estimatedPrice: decision.estimatedPrice,
    reasoning: decision.reasoning,
    signalsJson: JSON.stringify(signals.map((s) => ({ ticker: s.ticker, signal: s.signal, reasons: s.reasons }))),
    portfolioJson: JSON.stringify({ totalValue: snapshot.totalValue, aiValue, cash: snapshot.cash.free, positions: snapshot.positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, ppl: p.ppl })) }),
  })

  logAiUsage({ decisionId, timestamp, ...usage })

  // 8. Execute if buy or sell
  if (decision.action !== 'hold' && decision.ticker && decision.quantity) {
    const signal = signals.find((s) => s.ticker === decision.ticker)
    const estimatedPrice = decision.estimatedPrice ?? signal?.indicators.currentPrice ?? 0

    const risk = await validateOrder(
      { action: decision.action, ticker: decision.ticker, quantity: decision.quantity, estimatedPrice },
      botSnapshot,
      dailyOpenValue
    )

    if (!risk.allowed) {
      console.log(`[scheduler] Risk manager blocked order: ${risk.reason}`)
      logOrder({
        decisionId,
        t212OrderId: null,
        status: `blocked: ${risk.reason}`,
        fillPrice: null,
        fillQuantity: null,
        timestamp,
      })
      return
    }

    try {
      console.log(`[scheduler] Placing ${decision.action} order: ${decision.quantity} × ${decision.ticker}`)
      const orderResult = await placeMarketOrder(decision.ticker, decision.quantity, decision.action)
      if (decision.action === 'buy') {
        sessionCashCommitted += decision.quantity * estimatedPrice
        openAiPosition(decision.ticker, decision.quantity, estimatedPrice, timestamp)
      } else if (decision.action === 'sell') {
        closeAiPosition(decision.ticker, estimatedPrice, timestamp)
      }
      invalidatePortfolioCache()
      console.log(`[scheduler] Order placed: ${orderResult.id} (${orderResult.status})`)
      logOrder({
        decisionId,
        t212OrderId: orderResult.id,
        status: orderResult.status,
        fillPrice: null,       // T212 market orders fill asynchronously — update via polling if needed
        fillQuantity: decision.quantity,
        timestamp,
      })
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[scheduler] Order failed: ${msg}`)
      // If T212 says the position is already gone (stale snapshot from a previous cycle's
      // order still settling), reconcile the journal so we don't retry next cycle.
      if (decision.action === 'sell' && msg.includes('selling-equity-not-owned')) {
        console.log(`[scheduler] Position ${decision.ticker} already cleared in T212 — reconciling journal`)
        closeAiPosition(decision.ticker, estimatedPrice, timestamp)
      }
      logOrder({
        decisionId,
        t212OrderId: null,
        status: `error: ${msg}`,
        fillPrice: null,
        fillQuantity: null,
        timestamp,
      })
    }
  }
}

// ── Main loop ──────────────────────────────────────────────────────────────

export async function startLoop(): Promise<void> {
  console.log('[scheduler] Trader started')
  console.log(`[scheduler] Mode: ${config.trading212Mode.toUpperCase()} | Budget: €${config.maxBudgetEur} | Interval: ${Math.round(config.tradeIntervalMs / 60000)}min`)

  // Reconcile ai_positions from trade history — self-heals after crashes or any
  // gap between order placement and position recording.
  const { inserted } = reconcileAiPositions()
  if (inserted > 0) console.log(`[scheduler] Reconciled ${inserted} missing position record(s) from trade history`)

  // Validate universe tickers against T212 instrument list
  console.log('[scheduler] Validating universe tickers against T212...')
  const instruments = await getInstruments()
  const validUniverse = config.tradeUniverse.filter((t) => {
    if (instruments.has(t)) return true
    console.warn(`[scheduler] WARNING: "${t}" not found in T212 instruments — removing from universe`)
    return false
  })
  if (validUniverse.length !== config.tradeUniverse.length) {
    // Patch the live config so the rest of the run uses the validated list
    ;(config as { tradeUniverse: string[] }).tradeUniverse = validUniverse
  }
  console.log(`[scheduler] Universe (${validUniverse.length}): ${validUniverse.join(', ')}`)

  // Reconcile open AI positions against live T212 portfolio
  const openPositions = getOpenAiPositions()
  if (openPositions.length > 0) {
    const liveSnapshot = await getPortfolioSnapshot()
    const liveTickers = new Set(liveSnapshot.positions.map((p) => p.ticker))
    let reconciled = 0
    for (const pos of openPositions) {
      if (!liveTickers.has(pos.ticker)) {
        // Position no longer in T212 — mark closed (likely manually sold)
        closeAiPosition(pos.ticker, null, new Date().toISOString())
        console.log(`[scheduler] Reconcile: ${pos.ticker} no longer in T212 — marked closed`)
        reconciled++
      }
    }
    const stillOpen = openPositions.length - reconciled
    console.log(`[scheduler] Resuming with ${stillOpen} open AI position(s)${reconciled > 0 ? `, ${reconciled} reconciled` : ''}`)
  }

  async function tick(): Promise<void> {
    if (!isMarketOpen()) {
      const waitMs = nextOpenMs()
      const waitMin = Math.round(waitMs / 60000)
      console.log(`[scheduler] Markets closed — waiting ${waitMin} minutes until next open`)
      setTimeout(tick, waitMs)
      return
    }

    try {
      await runCycle()
    } catch (err) {
      console.error('[scheduler] Cycle error:', (err as Error).message)
    }

    setTimeout(tick, config.tradeIntervalMs)
  }

  await tick()
}

// CLI: run a single cycle immediately (npm run cycle)
if (process.argv.includes('--once')) {
  runCycle()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
