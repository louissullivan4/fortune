import { config } from '../config/index.js'
import {
  getPortfolioSnapshot,
  placeMarketOrder,
  getInstruments,
  invalidatePortfolioCache,
  type PortfolioSnapshot,
} from '../api/trading212.js'
import { getAllHistories } from '../api/marketdata.js'
import { generateSignals } from '../strategy/signals.js'
import { validateOrder } from './riskmanager.js'
import { decide } from './brain.js'
import {
  logDecision,
  logOrder,
  logAiUsage,
  upsertDailySnapshot,
  updateDailyClose as _updateDailyClose,
  getDailyOpenValue,
  getRecentDecisions,
  openAiPosition,
  closeAiPosition,
  closeAllAiPositions,
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

// ── Signal fingerprinting — skip AI when nothing actionable changed ────────

interface SignalFingerprint {
  fingerprint: string
  lastDecisionAction: 'buy' | 'sell' | 'hold'
}

let _lastSignalState: SignalFingerprint | null = null

/**
 * Bucket a P&L percentage into a coarse zone so small price drift doesn't
 * force a new AI call, but meaningful moves (>1%) do.
 */
function pplBucket(pctChange: number): string {
  if (pctChange <= -5) return 'stop'
  if (pctChange <= -1) return 'down'
  if (pctChange < 1) return 'flat'
  if (pctChange < 5) return 'up'
  return 'profit'
}

function computeSignalFingerprint(signals: import('../strategy/signals.js').TickerSignal[]): string {
  return signals
    .filter((s) => s.signal !== 'hold' || s.heldPosition)
    .map((s) => {
      const heldPart = s.heldPosition
        ? `:${pplBucket(((s.heldPosition.currentPrice - s.heldPosition.averagePrice) / s.heldPosition.averagePrice) * 100)}`
        : ''
      return `${s.ticker}:${s.signal}${heldPart}`
    })
    .sort()
    .join('|')
}

// ── Session cash tracking ──────────────────────────────────────────────────

let sessionCashCommitted = 0
let lastKnownFreeCash: number | null = null

function adjustedSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  if (lastKnownFreeCash !== null && snapshot.cash.free < lastKnownFreeCash) {
    const settled = lastKnownFreeCash - snapshot.cash.free
    sessionCashCommitted = Math.max(0, sessionCashCommitted - settled)
  }
  lastKnownFreeCash = snapshot.cash.free

  const effectiveFree = Math.max(0, snapshot.cash.free - sessionCashCommitted)
  return { ...snapshot, cash: { ...snapshot.cash, free: effectiveFree } }
}

// ── Trailing stop / hard stop-loss check ──────────────────────────────────

const TRAIL_ACTIVATION_PCT = 1.5
const TRAIL_STOP_PCT = 3.0

async function checkHardExits(snapshot: PortfolioSnapshot, timestamp: string): Promise<number> {
  const openPositions = await getOpenAiPositions()
  if (openPositions.length === 0) return 0

  let exitsPlaced = 0
  const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10))

  // Deduplicate: one check per ticker (multiple buys create multiple ai_positions records)
  const seenTickers = new Set<string>()
  for (const pos of openPositions) {
    if (seenTickers.has(pos.ticker)) continue
    seenTickers.add(pos.ticker)
    if (!pos.entryPrice) continue
    const live = snapshot.positions.find((p) => p.ticker === pos.ticker)
    if (!live) continue

    await updateHighWaterMark(pos.ticker, live.currentPrice)
    const hwm = Math.max(pos.highWaterMark ?? pos.entryPrice, live.currentPrice)

    const pctFromEntry = ((live.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
    const pctFromPeak = ((live.currentPrice - hwm) / hwm) * 100

    const stopLossPct = config.stopLossPct * 100
    const takeProfitPct = config.takeProfitPct * 100
    const isStopLoss = pctFromEntry <= -stopLossPct
    const isTakeProfit = pctFromEntry >= takeProfitPct
    const trailActivated =
      pctFromEntry >= TRAIL_ACTIVATION_PCT ||
      (pos.highWaterMark ?? 0) >= pos.entryPrice * (1 + TRAIL_ACTIVATION_PCT / 100)
    const isTrailingStop = trailActivated && pctFromPeak <= -TRAIL_STOP_PCT

    if (!isStopLoss && !isTakeProfit && !isTrailingStop) continue

    const reason = isStopLoss
      ? `Stop-loss: down ${Math.abs(pctFromEntry).toFixed(2)}% from entry €${pos.entryPrice.toFixed(2)}`
      : isTakeProfit
        ? `Take-profit: up ${pctFromEntry.toFixed(2)}% from entry €${pos.entryPrice.toFixed(2)} (target: ${takeProfitPct.toFixed(1)}%)`
        : `Trailing stop: down ${Math.abs(pctFromPeak).toFixed(2)}% from peak €${hwm.toFixed(2)} (entry €${pos.entryPrice.toFixed(2)}, +${pctFromEntry.toFixed(2)}%)`

    console.log(`[scheduler] Hard exit triggered — ${pos.ticker}: ${reason}`)

    const sellQty = live.quantity

    const risk = await validateOrder(
      { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: live.currentPrice },
      snapshot,
      dailyOpen ?? snapshot.totalValue
    )

    if (!risk.allowed) {
      console.log(`[scheduler] Risk blocked hard exit: ${risk.reason}`)
      continue
    }

    const decisionId = await logDecision({
      timestamp,
      action: 'sell',
      ticker: pos.ticker,
      quantity: sellQty,
      estimatedPrice: live.currentPrice,
      reasoning: reason,
      signalsJson: '[]',
      portfolioJson: JSON.stringify({ totalValue: snapshot.totalValue, cash: snapshot.cash.free }),
    })

    try {
      const order = await placeMarketOrder(pos.ticker, sellQty, 'sell')
      await closeAllAiPositions(pos.ticker, live.currentPrice, timestamp)
      invalidatePortfolioCache()
      console.log(`[scheduler] Hard exit order placed: ${order.id} (${order.status})`)
      await logOrder({
        decisionId,
        t212OrderId: order.id,
        status: order.status,
        fillPrice: live.currentPrice,
        fillQuantity: sellQty,
        timestamp,
      })
      exitsPlaced++
    } catch (err) {
      console.error(`[scheduler] Hard exit order failed: ${(err as Error).message}`)
      await logOrder({
        decisionId,
        t212OrderId: null,
        status: `error: ${(err as Error).message}`,
        fillPrice: null,
        fillQuantity: null,
        timestamp,
      })
    }
  }
  return exitsPlaced
}

// ── Stagnant position rotation ─────────────────────────────────────────────

async function checkStagnantExits(
  snapshot: PortfolioSnapshot,
  signals: import('../strategy/signals.js').TickerSignal[],
  timestamp: string
): Promise<number> {
  if (!config.stagnantExitEnabled) return 0

  const openPositions = await getOpenAiPositions()
  if (openPositions.length === 0) return 0

  // Only rotate if there is a buy/strong_buy signal on a ticker we don't already hold
  const heldTickers = new Set(openPositions.map((p) => p.ticker))
  const hasBetterOpportunity = signals.some(
    (s) => (s.signal === 'buy' || s.signal === 'strong_buy') && !heldTickers.has(s.ticker)
  )
  if (!hasBetterOpportunity) return 0

  const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10))
  let exitsPlaced = 0
  const seenTickers = new Set<string>()

  for (const pos of openPositions) {
    if (seenTickers.has(pos.ticker)) continue
    seenTickers.add(pos.ticker)
    if (!pos.entryPrice) continue

    const live = snapshot.positions.find((p) => p.ticker === pos.ticker)
    if (!live) continue

    const currentPrice = live.currentPrice
    const pctFromEntry = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
    const minutesHeld = (Date.now() - new Date(pos.openedAt).getTime()) / 60_000

    const isStagnant =
      minutesHeld >= config.stagnantTimeMinutes &&
      Math.abs(pctFromEntry) < config.stagnantRangePct * 100

    // Only exit at break-even or better (no loss — T212 is commission-free)
    const atBreakEven = currentPrice >= pos.entryPrice

    if (!isStagnant || !atBreakEven) continue

    const direction = pctFromEntry >= 0 ? '+' : ''
    console.log(
      `[scheduler] Stagnant exit: ${pos.ticker} held ${minutesHeld.toFixed(0)}min, ` +
        `${direction}${pctFromEntry.toFixed(2)}% from entry — rotating capital`
    )

    const sellQty = live.quantity

    const risk = await validateOrder(
      { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: currentPrice },
      snapshot,
      dailyOpen ?? snapshot.totalValue
    )

    if (!risk.allowed) {
      console.log(`[scheduler] Risk blocked stagnant exit for ${pos.ticker}: ${risk.reason}`)
      continue
    }

    const reason =
      `Stagnant exit: held ${minutesHeld.toFixed(0)} minutes with only ` +
      `${Math.abs(pctFromEntry).toFixed(2)}% movement from entry €${pos.entryPrice.toFixed(2)}. ` +
      `Rotating capital to better opportunities.`

    const decisionId = await logDecision({
      timestamp,
      action: 'sell',
      ticker: pos.ticker,
      quantity: sellQty,
      estimatedPrice: currentPrice,
      reasoning: reason,
      signalsJson: '[]',
      portfolioJson: JSON.stringify({ totalValue: snapshot.totalValue, cash: snapshot.cash.free }),
    })

    try {
      const order = await placeMarketOrder(pos.ticker, sellQty, 'sell')
      await closeAllAiPositions(pos.ticker, currentPrice, timestamp)
      invalidatePortfolioCache()
      console.log(`[scheduler] Stagnant exit order placed: ${order.id} (${order.status})`)
      await logOrder({
        decisionId,
        t212OrderId: order.id,
        status: order.status,
        fillPrice: currentPrice,
        fillQuantity: sellQty,
        timestamp,
      })
      exitsPlaced++
    } catch (err) {
      console.error(`[scheduler] Stagnant exit order failed: ${(err as Error).message}`)
      await logOrder({
        decisionId,
        t212OrderId: null,
        status: `error: ${(err as Error).message}`,
        fillPrice: null,
        fillQuantity: null,
        timestamp,
      })
    }
  }

  return exitsPlaced
}

// ── Single trading cycle ───────────────────────────────────────────────────

export async function runCycle(): Promise<void> {
  if (!isMarketOpen()) {
    console.log(
      '[scheduler] Markets are closed — skipping cycle (no AI calls outside trading hours)'
    )
    return
  }

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timestamp = now.toISOString()

  console.log(`\n[scheduler] ${timestamp} — running cycle`)

  // 1. Fetch portfolio snapshot
  const snapshot = adjustedSnapshot(await getPortfolioSnapshot())
  const pendingNote =
    sessionCashCommitted > 0 ? ` (€${sessionCashCommitted.toFixed(2)} pending settlement)` : ''
  console.log(
    `[scheduler] Portfolio: €${snapshot.totalValue.toFixed(2)} total, €${snapshot.cash.free.toFixed(2)} free cash${pendingNote}`
  )

  // 2. Hard exit check
  const exitsPlaced = await checkHardExits(snapshot, timestamp)
  if (exitsPlaced > 0) {
    const freshSnapshot = adjustedSnapshot(await getPortfolioSnapshot())
    Object.assign(snapshot, freshSnapshot)
  }

  const dailyOpenValue = (await getDailyOpenValue(dateStr)) ?? snapshot.totalValue

  // 4. Daily loss check
  const drawdown = (dailyOpenValue - snapshot.totalValue) / dailyOpenValue
  if (drawdown > config.dailyLossLimitPct) {
    console.log(
      `[scheduler] Daily loss limit hit (${(drawdown * 100).toFixed(1)}%) — halting for today`
    )
    return
  }

  // 4. Fetch market data
  console.log(`[scheduler] Fetching price history for ${config.tradeUniverse.length} tickers...`)
  const histories = await getAllHistories(config.tradeUniverse, 90)

  // 5. Generate signals
  const botTickers = new Set((await getOpenAiPositions()).map((p) => p.ticker))
  const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
  const signals = generateSignals(config.tradeUniverse, histories, botPositions)
  const actionable = signals.filter((s) => s.signal !== 'hold').length
  console.log(`[scheduler] Signals: ${signals.length} tickers, ${actionable} actionable`)

  const aiPositionsValue = botPositions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
  const aiValue = snapshot.cash.free + aiPositionsValue

  // 3. Record daily open snapshot
  await upsertDailySnapshot(dateStr, snapshot.totalValue, aiValue)

  // 5b. Stagnant position rotation — exit flat positions at break-even if better signals exist
  const stagnantExits = await checkStagnantExits(snapshot, signals, timestamp)
  if (stagnantExits > 0) {
    const freshSnapshot = adjustedSnapshot(await getPortfolioSnapshot())
    Object.assign(snapshot, freshSnapshot)
    _lastSignalState = null // force AI re-evaluation with updated portfolio
    console.log(`[scheduler] ${stagnantExits} stagnant exit(s) placed — portfolio refreshed`)
  }

  // 6. Ask Claude for a decision — skip if signals unchanged since last hold
  const currentFingerprint = computeSignalFingerprint(signals)
  const lastState = _lastSignalState
  const shouldSkipAi =
    lastState !== null &&
    lastState.lastDecisionAction === 'hold' &&
    lastState.fingerprint === currentFingerprint

  if (shouldSkipAi) {
    console.log('[scheduler] Signals unchanged since last hold — skipping AI call (cost saving)')
    return
  }

  const recentDecisions = await getRecentDecisions(5)
  console.log('[scheduler] Asking Claude for decision...')
  const botSnapshot = { ...snapshot, positions: botPositions }
  const { decision, usage } = await decide(signals, botSnapshot, recentDecisions)
  console.log(
    `[scheduler] Claude decision: ${decision.action.toUpperCase()} ${decision.ticker ?? ''}`
  )
  console.log(`[scheduler] Reasoning: ${decision.reasoning}`)
  console.log(
    `[scheduler] Token usage: ${usage.inputTokens} in / ${usage.outputTokens} out — $${usage.totalCostUsd.toFixed(6)}`
  )

  // 7. Log the decision and AI usage
  const decisionId = await logDecision({
    timestamp,
    action: decision.action,
    ticker: decision.ticker,
    quantity: decision.quantity,
    estimatedPrice: decision.estimatedPrice,
    reasoning: decision.reasoning,
    signalsJson: JSON.stringify(
      signals.map((s) => ({ ticker: s.ticker, signal: s.signal, reasons: s.reasons }))
    ),
    portfolioJson: JSON.stringify({
      totalValue: snapshot.totalValue,
      aiValue,
      cash: snapshot.cash.free,
      positions: snapshot.positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        ppl: p.ppl,
      })),
    }),
  })

  await logAiUsage({ decisionId, timestamp, ...usage })

  _lastSignalState = { fingerprint: currentFingerprint, lastDecisionAction: decision.action }

  // 8. Execute if buy or sell
  if (decision.action !== 'hold' && decision.ticker && decision.quantity) {
    const signal = signals.find((s) => s.ticker === decision.ticker)
    const estimatedPrice = decision.estimatedPrice ?? signal?.indicators.currentPrice ?? 0

    const risk = await validateOrder(
      {
        action: decision.action,
        ticker: decision.ticker,
        quantity: decision.quantity,
        estimatedPrice,
      },
      botSnapshot,
      dailyOpenValue
    )

    if (!risk.allowed) {
      console.log(`[scheduler] Risk manager blocked order: ${risk.reason}`)
      await logOrder({
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
      console.log(
        `[scheduler] Placing ${decision.action} order: ${decision.quantity} × ${decision.ticker}`
      )
      const orderResult = await placeMarketOrder(
        decision.ticker,
        decision.quantity,
        decision.action
      )
      if (decision.action === 'buy') {
        sessionCashCommitted += decision.quantity * estimatedPrice
        await openAiPosition(decision.ticker, decision.quantity, estimatedPrice, timestamp)
      } else if (decision.action === 'sell') {
        await closeAllAiPositions(decision.ticker, estimatedPrice, timestamp)
      }
      invalidatePortfolioCache()
      console.log(`[scheduler] Order placed: ${orderResult.id} (${orderResult.status})`)
      await logOrder({
        decisionId,
        t212OrderId: orderResult.id,
        status: orderResult.status,
        fillPrice: null,
        fillQuantity: decision.quantity,
        timestamp,
      })
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[scheduler] Order failed: ${msg}`)
      if (decision.action === 'sell' && msg.includes('selling-equity-not-owned')) {
        console.log(
          `[scheduler] Position ${decision.ticker} already cleared in T212 — reconciling journal`
        )
        await closeAllAiPositions(decision.ticker, estimatedPrice, timestamp)
      }
      await logOrder({
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
  console.log(
    `[scheduler] Mode: ${config.trading212Mode.toUpperCase()} | Budget: €${config.maxBudgetEur} | Interval: ${Math.round(config.tradeIntervalMs / 60000)}min`
  )

  const { inserted } = await reconcileAiPositions()
  if (inserted > 0)
    console.log(`[scheduler] Reconciled ${inserted} missing position record(s) from trade history`)

  console.log('[scheduler] Validating universe tickers against T212...')
  const instruments = await getInstruments()
  const validUniverse = config.tradeUniverse.filter((t) => {
    if (instruments.has(t)) return true
    console.warn(
      `[scheduler] WARNING: "${t}" not found in T212 instruments — removing from universe`
    )
    return false
  })
  if (validUniverse.length !== config.tradeUniverse.length) {
    ;(config as { tradeUniverse: string[] }).tradeUniverse = validUniverse
  }
  console.log(`[scheduler] Universe (${validUniverse.length}): ${validUniverse.join(', ')}`)

  const openPositions = await getOpenAiPositions()
  if (openPositions.length > 0) {
    const liveSnapshot = await getPortfolioSnapshot()
    const liveTickers = new Set(liveSnapshot.positions.map((p) => p.ticker))
    let reconciled = 0
    for (const pos of openPositions) {
      if (!liveTickers.has(pos.ticker)) {
        await closeAiPosition(pos.ticker, null, new Date().toISOString())
        console.log(`[scheduler] Reconcile: ${pos.ticker} no longer in T212 — marked closed`)
        reconciled++
      }
    }
    const stillOpen = openPositions.length - reconciled
    console.log(
      `[scheduler] Resuming with ${stillOpen} open AI position(s)${reconciled > 0 ? `, ${reconciled} reconciled` : ''}`
    )
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
