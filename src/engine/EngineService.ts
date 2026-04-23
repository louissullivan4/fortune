import { isMarketOpen, nextOpenMs, nyseTradingDateStr } from './scheduler.js'
import { decide } from './brain.js'
import { validateOrder } from './riskmanager.js'
import {
  reconcileAiPositions,
  getOpenAiPositions,
  closeAiPosition,
  closeAllAiPositions,
  openAiPosition,
  updateHighWaterMark,
  updateEntryPrice,
  getDailyOpenValue,
  getDailyAiOpenValue,
  getPreviousDayAiOpenValue,
  upsertDailySnapshot,
  logDecision,
  logOrder,
  logAiUsage,
  getRecentDecisions,
  type AiPosition,
} from '../analytics/journal.js'
import { Trading212Client, type PortfolioSnapshot, type T212Position } from '../api/trading212.js'
import { getAllHistories, getLivePrice } from '../api/marketdata.js'
import { generateSignals } from '../strategy/signals.js'
import type { TickerSignal } from '../strategy/signals.js'
import { hub } from '../ws/hub.js'
import type { UserConfig } from '../types/user.js'

export interface EngineStatus {
  running: boolean
  startedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  cycleCount: number
  marketOpen: boolean
  mode: string
  intervalMs: number
  userId: string
  pendingSettlement: number
}

// ── Constants ─────────────────────────────────────────────────────────────

const CASH_BUFFER_EUR = 5
const MIN_DEPLOYABLE_EUR = 6
// Ticker cooldown: once a position closes, don't re-enter it the same NYSE
// trading day. Prevents chasing the same setup back into a losing re-entry
// (e.g. FCX bought → sold → bought again 2h later → stopped out overnight).
const GAP_REJECT_COOLDOWN_MS = 30 * 60 * 1_000
const TRAIL_ACTIVATION_PCT = 0.8
const TRAIL_STOP_PCT = 0.4
const CASH_COMMITMENT_TTL_MS = 90_000
const MAX_FINGERPRINT_SKIPS = 4
// Reject a buy if the live intraday price differs from the signal (daily close)
// by more than this. Catches gap-ups/gap-downs where the signal is stale.
const GAP_REJECT_PCT = 0.05
// Correct a stored entry_price when T212's fill deviates by more than this.
const ENTRY_PRICE_CORRECTION_THRESHOLD = 0.02

// ── Signal fingerprinting ──────────────────────────────────────────────────

interface SignalFingerprint {
  fingerprint: string
  lastDecisionAction: 'buy' | 'sell' | 'hold'
}

interface StagnantCandidate {
  pos: AiPosition
  live: T212Position
  currentPrice: number
  sellQty: number
  reason: string
  minutesHeld: number
  pctFromEntry: number
}

function pplBucket(pctChange: number): string {
  if (pctChange <= -5) return 'stop'
  if (pctChange <= -1) return 'down'
  if (pctChange < 1) return 'flat'
  if (pctChange < 5) return 'up'
  return 'profit'
}

function computeSignalFingerprint(signals: TickerSignal[], freeCash: number): string {
  const cashBucket = freeCash < CASH_BUFFER_EUR + MIN_DEPLOYABLE_EUR ? 'c:low' : 'c:ok'
  const signalPart = signals
    .filter((s) => s.signal !== 'hold' || s.heldPosition)
    .map((s) => {
      const heldPart = s.heldPosition
        ? `:${pplBucket(((s.heldPosition.currentPrice - s.heldPosition.averagePrice) / s.heldPosition.averagePrice) * 100)}`
        : ''
      return `${s.ticker}:${s.signal}${heldPart}`
    })
    .sort()
    .join('|')
  return `${cashBucket}|${signalPart}`
}

// ── Per-user EngineService ─────────────────────────────────────────────────

export class EngineService {
  private _running = false
  private _startedAt: string | null = null
  private _lastCycleAt: string | null = null
  private _nextCycleAt: string | null = null
  private _cycleCount = 0
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _initialized = false

  // Session state per cycle
  private _lastSignalState: SignalFingerprint | null = null
  private _cashCommitments: Array<{ amount: number; expiresAt: number }> = []
  private _lastKnownFreeCash: number | null = null

  private get _sessionCashCommitted(): number {
    const now = Date.now()
    return this._cashCommitments
      .filter((c) => c.expiresAt > now)
      .reduce((sum, c) => sum + c.amount, 0)
  }
  private _cycleRunning = false
  // ticker → NYSE trading-date string (YYYY-MM-DD ET) the position was closed on
  private _recentlyClosedTickers = new Map<string, string>()
  private _gapRejectedAt = new Map<string, number>()
  private _lastSeenPrices = new Map<string, number>()
  private _consecutiveFingerprintSkips = 0

  constructor(
    public readonly userId: string,
    public readonly t212: Trading212Client,
    private anthropicApiKey: string,
    private userConfig: UserConfig
  ) {}

  /** Called by engine route when config is updated at runtime */
  updateConfig(config: UserConfig): void {
    this.userConfig = config
  }

  get status(): EngineStatus {
    return {
      running: this._running,
      startedAt: this._startedAt,
      lastCycleAt: this._lastCycleAt,
      nextCycleAt: this._nextCycleAt,
      cycleCount: this._cycleCount,
      marketOpen: isMarketOpen(),
      mode: this.t212['mode'] as string,
      intervalMs: this.userConfig.tradeIntervalMs,
      userId: this.userId,
      pendingSettlement: this._sessionCashCommitted,
    }
  }

  async start(): Promise<EngineStatus> {
    if (this._running) return this.status
    this._running = true
    this._startedAt = new Date().toISOString()

    if (!this._initialized) {
      await this._initialize()
      this._initialized = true
    }

    this._scheduleTick()
    hub.broadcast('engine_status', this.status)
    return this.status
  }

  stop(): EngineStatus {
    this._running = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this._nextCycleAt = null
    hub.broadcast('engine_status', this.status)
    return this.status
  }

  async triggerCycle(): Promise<EngineStatus> {
    await this._runCycle()
    return this.status
  }

  // ── Initialization ─────────────────────────────────────────────────────

  private async _initialize(): Promise<void> {
    console.log(`[engine:${this.userId}] Initializing...`)
    const { inserted } = await reconcileAiPositions(this.userId)
    if (inserted > 0) console.log(`[engine:${this.userId}] Reconciled ${inserted} position(s)`)

    const instruments = await this.t212.getInstruments()
    const validUniverse = this.userConfig.tradeUniverse.filter((t) => {
      if (instruments.has(t)) return true
      console.warn(`[engine:${this.userId}] "${t}" not in T212 — removing from universe`)
      return false
    })
    if (validUniverse.length !== this.userConfig.tradeUniverse.length) {
      this.userConfig = { ...this.userConfig, tradeUniverse: validUniverse }
    }

    const openPositions = await getOpenAiPositions(this.userId)
    if (openPositions.length > 0) {
      const [liveSnapshot, openOrders] = await Promise.all([
        this.t212.getPortfolioSnapshot(),
        this.t212.getOpenOrders(),
      ])
      const liveTickers = new Set(liveSnapshot.positions.map((p) => p.ticker))
      const pendingOrderTickers = new Set(openOrders.map((o) => o.ticker))
      for (const pos of openPositions) {
        if (!liveTickers.has(pos.ticker) && !pendingOrderTickers.has(pos.ticker)) {
          await closeAiPosition(pos.ticker, null, new Date().toISOString(), this.userId)
          console.log(`[engine:${this.userId}] ${pos.ticker} not in T212 — marked closed`)
        }
      }
      await this._reconcileEntryPrices(openPositions, liveSnapshot.positions)
    }
    console.log(
      `[engine:${this.userId}] Ready. Universe: ${this.userConfig.tradeUniverse.join(', ')}`
    )
  }

  // ── Fill-price reconciliation ───────────────────────────────────────────
  // T212's averagePrice is the authoritative fill price. If our stored
  // entry_price diverges by more than ENTRY_PRICE_CORRECTION_THRESHOLD (e.g.
  // because the signal price was stale at buy time), correct it so take-profit
  // and stop-loss calculations are based on what was actually paid.

  private async _reconcileEntryPrices(
    openPositions: AiPosition[],
    t212Positions: PortfolioSnapshot['positions']
  ): Promise<void> {
    for (const pos of openPositions) {
      if (!pos.entryPrice) continue
      const live = t212Positions.find((p) => p.ticker === pos.ticker)
      if (!live) continue
      const deviation = Math.abs(live.averagePrice - pos.entryPrice) / pos.entryPrice
      if (deviation > ENTRY_PRICE_CORRECTION_THRESHOLD) {
        console.log(
          `[engine:${this.userId}] Correcting entry_price for ${pos.ticker}: ` +
            `${pos.entryPrice.toFixed(4)} → ${live.averagePrice.toFixed(4)} ` +
            `(${(deviation * 100).toFixed(1)}% deviation from T212 average fill)`
        )
        await updateEntryPrice(pos.ticker, live.averagePrice, this.userId)
      }
    }
  }

  // ── Adjusted snapshot (session cash accounting) ─────────────────────────

  private _adjustedSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
    const now = Date.now()

    this._cashCommitments = this._cashCommitments.filter((c) => c.expiresAt > now)

    if (this._lastKnownFreeCash !== null && snapshot.cash.free < this._lastKnownFreeCash) {
      let settled = this._lastKnownFreeCash - snapshot.cash.free
      const remaining: Array<{ amount: number; expiresAt: number }> = []
      for (const c of this._cashCommitments) {
        if (settled >= c.amount) {
          settled -= c.amount
        } else if (settled > 0) {
          remaining.push({ amount: c.amount - settled, expiresAt: c.expiresAt })
          settled = 0
        } else {
          remaining.push(c)
        }
      }
      this._cashCommitments = remaining
    }

    this._lastKnownFreeCash = snapshot.cash.free

    const committed = this._sessionCashCommitted
    const effectiveFree = Math.max(0, snapshot.cash.free - committed)

    const commitNote =
      committed > 0
        ? ` | ${this._cashCommitments.length} pending order(s) =€${committed.toFixed(2)} (expire in ${Math.round((Math.min(...this._cashCommitments.map((c) => c.expiresAt)) - now) / 1_000)}s)`
        : ''
    console.log(
      `[engine:${this.userId}] Cash: raw=€${snapshot.cash.free.toFixed(2)} blocked=€${snapshot.cash.blocked.toFixed(2)}${commitNote} → effective=€${effectiveFree.toFixed(2)}`
    )

    return { ...snapshot, cash: { ...snapshot.cash, free: effectiveFree } }
  }

  // ── Ticker cooldown ─────────────────────────────────────────────────────

  private _recordTickerClose(ticker: string): void {
    this._recentlyClosedTickers.set(ticker, nyseTradingDateStr())
  }

  private _purgeStaleCooldowns(): void {
    const today = nyseTradingDateStr()
    for (const [ticker, closedOn] of this._recentlyClosedTickers) {
      if (closedOn !== today) this._recentlyClosedTickers.delete(ticker)
    }
    const gapCutoff = Date.now() - GAP_REJECT_COOLDOWN_MS
    for (const [ticker, rejectedAt] of this._gapRejectedAt) {
      if (rejectedAt < gapCutoff) this._gapRejectedAt.delete(ticker)
    }
  }

  // ── Hard exit check ─────────────────────────────────────────────────────

  private async _checkHardExits(snapshot: PortfolioSnapshot, timestamp: string): Promise<number> {
    const openPositions = await getOpenAiPositions(this.userId)
    if (openPositions.length === 0) return 0

    let exitsPlaced = 0
    const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10), this.userId)

    const seenTickers = new Set<string>()
    for (const pos of openPositions) {
      if (seenTickers.has(pos.ticker)) continue
      seenTickers.add(pos.ticker)
      if (!pos.entryPrice) continue
      const live = snapshot.positions.find((p) => p.ticker === pos.ticker)
      if (!live) continue

      const currentPriceEur = live.currentPrice
      await updateHighWaterMark(pos.ticker, currentPriceEur, this.userId)
      const hwm = Math.max(pos.highWaterMark ?? pos.entryPrice, currentPriceEur)

      const pctFromEntry = ((currentPriceEur - pos.entryPrice) / pos.entryPrice) * 100
      const pctFromPeak = ((currentPriceEur - hwm) / hwm) * 100

      const stopLossPct = this.userConfig.stopLossPct * 100
      const takeProfitPct = this.userConfig.takeProfitPct * 100
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

      console.log(`[engine:${this.userId}] Hard exit — ${pos.ticker}: ${reason}`)

      const sellQty = live.quantity
      const risk = await validateOrder(
        {
          action: 'sell',
          ticker: pos.ticker,
          quantity: sellQty,
          estimatedPrice: currentPriceEur,
        },
        snapshot,
        dailyOpen ?? snapshot.totalValue,
        this.t212,
        this.userConfig
      )
      if (!risk.allowed) continue

      const decisionId = await logDecision({
        timestamp,
        action: 'sell',
        ticker: pos.ticker,
        quantity: sellQty,
        estimatedPrice: currentPriceEur,
        reasoning: reason,
        signalsJson: '[]',
        portfolioJson: JSON.stringify({
          totalValue: snapshot.totalValue,
          cash: snapshot.cash.free,
        }),
        userId: this.userId,
      })

      try {
        const order = await this.t212.placeMarketOrder(pos.ticker, sellQty, 'sell')
        await closeAllAiPositions(pos.ticker, currentPriceEur, timestamp, this.userId)
        this._recordTickerClose(pos.ticker)
        this.t212.invalidatePortfolioCache()
        this.t212.invalidateOrderHistoryCache()
        await logOrder({
          decisionId,
          t212OrderId: order.id,
          status: order.status,
          fillPrice: currentPriceEur,
          fillQuantity: sellQty,
          timestamp,
          userId: this.userId,
        })
        exitsPlaced++
      } catch (err) {
        await logOrder({
          decisionId,
          t212OrderId: null,
          status: `error: ${(err as Error).message}`,
          fillPrice: null,
          fillQuantity: null,
          timestamp,
          userId: this.userId,
        })
      }
    }
    return exitsPlaced
  }

  // ── Stagnant exit — identification ─────────────────────────────────────────

  private async _identifyStagnantCandidates(
    snapshot: PortfolioSnapshot,
    signals: TickerSignal[]
  ): Promise<StagnantCandidate[]> {
    if (!this.userConfig.stagnantExitEnabled) return []

    const openPositions = await getOpenAiPositions(this.userId)
    if (openPositions.length === 0) return []

    const heldTickers = new Set(openPositions.map((p) => p.ticker))
    const hasBetterOpportunity = signals.some(
      (s) => s.signal === 'strong_buy' && !heldTickers.has(s.ticker)
    )
    if (!hasBetterOpportunity) return []

    const candidates: StagnantCandidate[] = []
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

      // Positions drifting within ±stagnantRangePct% of entry count as stagnant
      // whether they're slightly up or slightly down. Losing drifters used to
      // be skipped (atBreakEven guard) and left to sit until the stop-loss —
      // now they rotate too, capping the realised loss at stagnantRangePct.
      const isStagnant =
        minutesHeld >= this.userConfig.stagnantTimeMinutes &&
        Math.abs(pctFromEntry) < this.userConfig.stagnantRangePct * 100
      const hwm = pos.highWaterMark ?? pos.entryPrice
      const positionRanUp = hwm > pos.entryPrice * (1 + this.userConfig.stagnantRangePct)

      const lastPrice = this._lastSeenPrices.get(pos.ticker)
      const isTrendingUp = lastPrice !== undefined && currentPrice > lastPrice

      if (!isStagnant || positionRanUp || isTrendingUp) continue

      const direction = pctFromEntry >= 0 ? '+' : ''
      const reason =
        `Stagnant exit: held ${minutesHeld.toFixed(0)} minutes with only ` +
        `${direction}${Math.abs(pctFromEntry).toFixed(2)}% movement from entry €${pos.entryPrice.toFixed(2)}. ` +
        `Rotating capital to better opportunities.`

      candidates.push({
        pos,
        live,
        currentPrice,
        sellQty: live.quantity,
        reason,
        minutesHeld,
        pctFromEntry,
      })
    }

    return candidates
  }

  // ── Stagnant exit — execution ───────────────────────────────────────────────

  private async _executeStagnantExits(
    candidates: StagnantCandidate[],
    aiSoldTicker: string | null,
    snapshot: PortfolioSnapshot,
    timestamp: string
  ): Promise<number> {
    const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10), this.userId)
    let exitsPlaced = 0

    for (const { pos, currentPrice, sellQty, reason } of candidates) {
      if (pos.ticker === aiSoldTicker) {
        console.log(
          `[engine:${this.userId}] Stagnant exit for ${pos.ticker} deferred — AI already sold`
        )
        continue
      }

      const risk = await validateOrder(
        { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: currentPrice },
        snapshot,
        dailyOpen ?? snapshot.totalValue,
        this.t212,
        this.userConfig
      )
      if (!risk.allowed) continue

      const decisionId = await logDecision({
        timestamp,
        action: 'sell',
        ticker: pos.ticker,
        quantity: sellQty,
        estimatedPrice: currentPrice,
        reasoning: reason,
        signalsJson: '[]',
        portfolioJson: JSON.stringify({
          totalValue: snapshot.totalValue,
          cash: snapshot.cash.free,
        }),
        userId: this.userId,
      })

      try {
        const order = await this.t212.placeMarketOrder(pos.ticker, sellQty, 'sell')
        await closeAllAiPositions(pos.ticker, currentPrice, timestamp, this.userId)
        this._recordTickerClose(pos.ticker)
        this.t212.invalidatePortfolioCache()
        this.t212.invalidateOrderHistoryCache()
        await logOrder({
          decisionId,
          t212OrderId: order.id,
          status: order.status,
          fillPrice: currentPrice,
          fillQuantity: sellQty,
          timestamp,
          userId: this.userId,
        })
        exitsPlaced++
      } catch (err) {
        await logOrder({
          decisionId,
          t212OrderId: null,
          status: `error: ${(err as Error).message}`,
          fillPrice: null,
          fillQuantity: null,
          timestamp,
          userId: this.userId,
        })
      }
    }

    return exitsPlaced
  }

  // ── Last-seen price tracking (momentum guard) ───────────────────────────────

  private _updateLastSeenPrices(snapshot: PortfolioSnapshot): void {
    for (const pos of snapshot.positions) {
      this._lastSeenPrices.set(pos.ticker, pos.currentPrice)
    }
  }

  // ── Main cycle ─────────────────────────────────────────────────────────

  private async _cycle(): Promise<void> {
    if (!isMarketOpen()) {
      console.log(`[engine:${this.userId}] Markets closed — skipping cycle`)
      return
    }

    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const timestamp = now.toISOString()

    this._purgeStaleCooldowns()
    console.log(`\n[engine:${this.userId}] ${timestamp} — running cycle`)

    const snapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
    console.log(
      `[engine:${this.userId}] Portfolio: €${snapshot.totalValue.toFixed(2)} total, €${snapshot.cash.free.toFixed(2)} effective free cash`
    )

    // Correct any entry_prices that were recorded from stale signal data rather
    // than actual T212 fill prices. Runs every cycle so positions opened last
    // cycle are corrected before the first take-profit/stop-loss check.
    const openForReconcile = await getOpenAiPositions(this.userId)
    if (openForReconcile.length > 0) {
      await this._reconcileEntryPrices(openForReconcile, snapshot.positions)
    }

    console.log(`[engine:${this.userId}] Checking hard exits...`)
    const exitsPlaced = await this._checkHardExits(snapshot, timestamp)
    if (exitsPlaced > 0) {
      console.log(
        `[engine:${this.userId}] ${exitsPlaced} hard exit(s) placed — refreshing snapshot`
      )
      const freshSnapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
      Object.assign(snapshot, freshSnapshot)
    } else {
      console.log(`[engine:${this.userId}] No hard exits triggered`)
    }

    // Compute bot-scoped values before any halts so the daily snapshot is always written.
    // T212 aggregates bot + manual shares under one ticker; scale its EUR value by the
    // bot's tracked share of the position so manual stakes don't consume the bot budget.
    const openAiPositions = await getOpenAiPositions(this.userId)
    const botQtyByTicker = new Map<string, number>()
    for (const pos of openAiPositions) {
      botQtyByTicker.set(pos.ticker, (botQtyByTicker.get(pos.ticker) ?? 0) + pos.quantity)
    }
    const botPositions = snapshot.positions.filter((p) => botQtyByTicker.has(p.ticker))
    const aiPositionsValue = botPositions.reduce((sum, p) => {
      const botQty = Math.min(botQtyByTicker.get(p.ticker) ?? 0, p.quantity)
      const share = p.quantity > 0 ? botQty / p.quantity : 0
      return sum + p.valueEur * share
    }, 0)
    // Cap the bot's visible cash to its remaining budget — never touch personal cash
    const botBudgetRemaining = Math.max(0, this.userConfig.maxBudgetEur - aiPositionsValue)
    const botCash = Math.min(botBudgetRemaining, snapshot.cash.free)
    const aiValue = botCash + aiPositionsValue
    console.log(
      `[engine:${this.userId}] Budget: max=€${this.userConfig.maxBudgetEur.toFixed(2)} inPositions=€${aiPositionsValue.toFixed(2)} remaining=€${botBudgetRemaining.toFixed(2)} freeCash=€${snapshot.cash.free.toFixed(2)} → botCash=€${botCash.toFixed(2)}${botBudgetRemaining < snapshot.cash.free ? ' [budget cap]' : ' [cash cap]'}`
    )

    await upsertDailySnapshot(dateStr, snapshot.totalValue, aiValue, this.userId)

    const dailyOpenValue = (await getDailyOpenValue(dateStr, this.userId)) ?? snapshot.totalValue
    const dailyAiOpenValue = (await getDailyAiOpenValue(dateStr, this.userId)) ?? aiValue
    const previousDayAiValue =
      (await getPreviousDayAiOpenValue(dateStr, this.userId)) ?? dailyAiOpenValue

    const aiDrawdown = (previousDayAiValue - aiValue) / previousDayAiValue
    if (aiDrawdown > this.userConfig.dailyLossLimitPct) {
      console.log(
        `[engine:${this.userId}] Bot daily loss limit hit (${(aiDrawdown * 100).toFixed(1)}% vs yesterday) — halting for today`
      )
      return
    }

    console.log(
      `[engine:${this.userId}] Fetching price history for ${this.userConfig.tradeUniverse.length} tickers...`
    )
    const histories = await getAllHistories(this.userConfig.tradeUniverse, 90)

    const manualTickers = new Set(
      snapshot.positions.map((p) => p.ticker).filter((t) => !botQtyByTicker.has(t))
    )
    const todayNy = nyseTradingDateStr()
    const coolingTickers = new Set(
      [...this._recentlyClosedTickers.entries()]
        .filter(([, closedOn]) => closedOn === todayNy)
        .map(([t]) => t)
    )
    const gapRejectedTickers = new Set(
      [...this._gapRejectedAt.keys()].filter(
        (t) => Date.now() - (this._gapRejectedAt.get(t) ?? 0) < GAP_REJECT_COOLDOWN_MS
      )
    )
    const buyUniverse = this.userConfig.tradeUniverse.filter(
      (t) =>
        !botQtyByTicker.has(t) &&
        !manualTickers.has(t) &&
        !coolingTickers.has(t) &&
        !gapRejectedTickers.has(t)
    )
    if (botQtyByTicker.size > 0) {
      console.log(
        `[engine:${this.userId}] Excluding bot-held tickers from buy universe: ${[...botQtyByTicker.keys()].join(', ')}`
      )
    }
    if (manualTickers.size > 0) {
      console.log(
        `[engine:${this.userId}] Excluding manually held tickers from buy universe: ${[...manualTickers].join(', ')}`
      )
    }
    if (coolingTickers.size > 0) {
      console.log(
        `[engine:${this.userId}] Cooling down tickers (recently closed): ${[...coolingTickers].join(', ')}`
      )
    }
    if (gapRejectedTickers.size > 0) {
      console.log(
        `[engine:${this.userId}] Gap-rejected tickers (stale signal price): ${[...gapRejectedTickers].join(', ')}`
      )
    }
    const signals = generateSignals(buyUniverse, histories, botPositions)
    const actionable = signals.filter((s) => s.signal !== 'hold').length
    console.log(
      `[engine:${this.userId}] Signals: ${signals.length} tickers, ${actionable} actionable`
    )

    console.log(`[engine:${this.userId}] Identifying stagnant candidates...`)
    const stagnantCandidates = await this._identifyStagnantCandidates(snapshot, signals)
    if (stagnantCandidates.length > 0) {
      console.log(
        `[engine:${this.userId}] ${stagnantCandidates.length} stagnant candidate(s): ${stagnantCandidates.map((c) => c.pos.ticker).join(', ')} — deferring to AI`
      )
    } else {
      console.log(`[engine:${this.userId}] No stagnant candidates`)
    }

    const currentFingerprint = computeSignalFingerprint(signals, botCash)
    const lastState = this._lastSignalState
    const shouldSkipAi =
      lastState !== null &&
      lastState.lastDecisionAction === 'hold' &&
      lastState.fingerprint === currentFingerprint &&
      stagnantCandidates.length === 0

    if (shouldSkipAi) {
      this._consecutiveFingerprintSkips++
      if (this._consecutiveFingerprintSkips < MAX_FINGERPRINT_SKIPS) {
        console.log(
          `[engine:${this.userId}] Signals + cash unchanged since last hold — skipping AI call (${this._consecutiveFingerprintSkips}/${MAX_FINGERPRINT_SKIPS})`
        )
        return
      }
      console.log(
        `[engine:${this.userId}] Signals unchanged for ${MAX_FINGERPRINT_SKIPS} cycles — forcing AI re-check`
      )
      this._consecutiveFingerprintSkips = 0
    } else {
      this._consecutiveFingerprintSkips = 0
    }

    const cashBuffer = CASH_BUFFER_EUR
    const deployable = botCash - cashBuffer
    if (deployable < MIN_DEPLOYABLE_EUR && stagnantCandidates.length === 0) {
      const reason = `Cash-constrained hold: €${botCash.toFixed(2)} bot cash (budget €${this.userConfig.maxBudgetEur} − €${aiPositionsValue.toFixed(2)} in positions), €${deployable.toFixed(2)} deployable after €${cashBuffer} buffer — minimum €${MIN_DEPLOYABLE_EUR} needed to open a position`
      console.log(`[engine:${this.userId}] ${reason}`)
      await logDecision({
        timestamp,
        action: 'hold',
        ticker: null,
        quantity: null,
        estimatedPrice: null,
        reasoning: reason,
        signalsJson: JSON.stringify(
          signals.map((s) => ({ ticker: s.ticker, signal: s.signal, reasons: s.reasons }))
        ),
        portfolioJson: JSON.stringify({
          totalValue: snapshot.totalValue,
          aiValue,
          cash: snapshot.cash.free,
        }),
        userId: this.userId,
      })
      this._lastSignalState = { fingerprint: currentFingerprint, lastDecisionAction: 'hold' }
      return
    }

    const recentDecisions = await getRecentDecisions(this.userId, 5)
    console.log(`[engine:${this.userId}] Asking Claude for decision...`)
    const botSnapshot = {
      ...snapshot,
      positions: botPositions,
      cash: { ...snapshot.cash, free: botCash },
    }
    const stagnantInfo = stagnantCandidates.map((c) => ({
      ticker: c.pos.ticker,
      minutesHeld: Math.round(c.minutesHeld),
      pctFromEntry: c.pctFromEntry,
    }))
    const { decision, usage } = await decide(
      signals,
      botSnapshot,
      recentDecisions,
      this.anthropicApiKey,
      this.t212,
      this.userConfig,
      stagnantInfo
    )
    console.log(
      `[engine:${this.userId}] Claude decision: ${decision.action.toUpperCase()} ${decision.ticker ?? ''}`
    )
    console.log(
      `[engine:${this.userId}] Token usage: ${usage.inputTokens} in / ${usage.outputTokens} out — $${usage.totalCostUsd.toFixed(6)}`
    )

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
      userId: this.userId,
    })

    await logAiUsage({ decisionId, timestamp, ...usage, userId: this.userId })

    this._lastSignalState = {
      fingerprint: currentFingerprint,
      lastDecisionAction: decision.action,
    }

    // Execute stagnant exits now that the AI has had its say — skip any ticker the AI sold
    const aiSoldTicker = decision.action === 'sell' && decision.ticker ? decision.ticker : null
    if (stagnantCandidates.length > 0) {
      const stagnantExits = await this._executeStagnantExits(
        stagnantCandidates,
        aiSoldTicker,
        snapshot,
        timestamp
      )
      if (stagnantExits > 0) {
        const freshSnapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
        Object.assign(snapshot, freshSnapshot)
        this._lastSignalState = null
        console.log(
          `[engine:${this.userId}] ${stagnantExits} stagnant exit(s) placed — refreshing snapshot`
        )
      }
    }

    this._updateLastSeenPrices(snapshot)

    if (decision.action !== 'hold' && decision.ticker && decision.quantity) {
      const signal = signals.find((s) => s.ticker === decision.ticker)
      let estimatedPriceNative = decision.estimatedPrice ?? signal?.indicators.currentPrice ?? 0

      // For BUY orders, cross-check the signal price (daily close from Yahoo)
      // against a fresh intraday quote. If the stock has gapped significantly,
      // abort: we'd be chasing a move with a stale signal and a wrong entry_price.
      if (decision.action === 'buy' && estimatedPriceNative > 0) {
        const liveQuote = await getLivePrice(decision.ticker)
        if (liveQuote !== null) {
          const gapPct = Math.abs(liveQuote - estimatedPriceNative) / estimatedPriceNative
          if (gapPct > GAP_REJECT_PCT) {
            console.log(
              `[engine:${this.userId}] GAP GUARD — ${decision.ticker}: signal $${estimatedPriceNative.toFixed(2)} vs live $${liveQuote.toFixed(2)} (${(gapPct * 100).toFixed(1)}% gap > ${GAP_REJECT_PCT * 100}%) — aborting buy`
            )
            this._gapRejectedAt.set(decision.ticker, Date.now())
            await logDecision({
              timestamp,
              action: 'hold',
              ticker: null,
              quantity: null,
              estimatedPrice: null,
              reasoning: `Gap guard: ${decision.ticker} signal price $${estimatedPriceNative.toFixed(2)} is ${(gapPct * 100).toFixed(1)}% away from live $${liveQuote.toFixed(2)} — buy aborted, ticker cooling for ${GAP_REJECT_COOLDOWN_MS / 60_000} min`,
              signalsJson: JSON.stringify(
                signals.map((s) => ({ ticker: s.ticker, signal: s.signal, reasons: s.reasons }))
              ),
              portfolioJson: JSON.stringify({
                totalValue: snapshot.totalValue,
                aiValue,
                cash: snapshot.cash.free,
              }),
              userId: this.userId,
            })
            return
          }
          // Use the live price for entry so stop-loss/take-profit anchor to reality.
          estimatedPriceNative = liveQuote
        }
      }

      const livePosition = snapshot.positions.find((p) => p.ticker === decision.ticker)
      const fxRate =
        livePosition?.fxRate ??
        (() => {
          const currency = livePosition?.currencyCode
          if (!currency || currency === 'EUR') return 1
          return snapshot.positions.find((p) => p.currencyCode === currency)?.fxRate ?? 1
        })()
      const estimatedPriceEur = estimatedPriceNative * fxRate

      const risk = await validateOrder(
        {
          action: decision.action,
          ticker: decision.ticker,
          quantity: decision.quantity,
          estimatedPrice: estimatedPriceNative,
        },
        botSnapshot,
        dailyOpenValue,
        this.t212,
        this.userConfig,
        aiValue,
        dailyAiOpenValue
      )

      if (!risk.allowed) {
        console.log(`[engine:${this.userId}] Risk manager blocked: ${risk.reason}`)
        await logOrder({
          decisionId,
          t212OrderId: null,
          status: `blocked: ${risk.reason}`,
          fillPrice: null,
          fillQuantity: null,
          timestamp,
          userId: this.userId,
        })
        return
      }

      console.log(`[engine:${this.userId}] Risk check passed — submitting order to T212`)
      try {
        console.log(
          `[engine:${this.userId}] Placing ${decision.action} order: ${decision.quantity} × ${decision.ticker}`
        )

        const orderResult = await this.t212.placeMarketOrder(
          decision.ticker,
          decision.quantity,
          decision.action
        )

        if (decision.action === 'buy') {
          this._cashCommitments.push({
            amount: decision.quantity * estimatedPriceEur,
            expiresAt: Date.now() + CASH_COMMITMENT_TTL_MS,
          })
          await openAiPosition(
            decision.ticker,
            decision.quantity,
            estimatedPriceNative,
            timestamp,
            this.userId
          )
        } else if (decision.action === 'sell') {
          await closeAllAiPositions(decision.ticker, estimatedPriceNative, timestamp, this.userId)
          this._recordTickerClose(decision.ticker)
        }
        this.t212.invalidatePortfolioCache()
        this.t212.invalidateOrderHistoryCache()
        console.log(
          `[engine:${this.userId}] Order placed: ${orderResult.id} (${orderResult.status})`
        )
        await logOrder({
          decisionId,
          t212OrderId: orderResult.id,
          status: orderResult.status,
          fillPrice: null,
          fillQuantity: decision.quantity,
          timestamp,
          userId: this.userId,
        })
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[engine:${this.userId}] Order failed: ${msg}`)
        if (decision.action === 'sell' && msg.includes('selling-equity-not-owned')) {
          await closeAllAiPositions(decision.ticker, estimatedPriceNative, timestamp, this.userId)
        }
        await logOrder({
          decisionId,
          t212OrderId: null,
          status: `error: ${msg}`,
          fillPrice: null,
          fillQuantity: null,
          timestamp,
          userId: this.userId,
        })
      }
    }

    hub.broadcast('decision', { cycleAt: timestamp, count: this._cycleCount, userId: this.userId })
    hub.broadcast('engine_status', this.status)
  }

  private async _runCycle(): Promise<void> {
    if (this._cycleRunning) {
      console.log(`[engine:${this.userId}] Cycle already in progress — skipping`)
      return
    }
    this._cycleRunning = true
    this._lastCycleAt = new Date().toISOString()
    const cycleStart = Date.now()
    try {
      await this._cycle()
      this._cycleCount++
      const elapsed = ((Date.now() - cycleStart) / 1_000).toFixed(1)
      console.log(`[engine:${this.userId}] Cycle #${this._cycleCount} complete in ${elapsed}s`)
    } catch (err) {
      const msg = (err as Error).message
      const elapsed = ((Date.now() - cycleStart) / 1_000).toFixed(1)
      console.error(`[engine:${this.userId}] Cycle failed after ${elapsed}s: ${msg}`)
      hub.broadcast('toast', { message: `Cycle error: ${msg}`, level: 'error' })
    } finally {
      this._cycleRunning = false
    }
    hub.broadcast('engine_status', this.status)
  }

  private _scheduleTick(): void {
    if (!this._running) return

    if (!isMarketOpen()) {
      const waitMs = nextOpenMs()
      this._nextCycleAt = new Date(Date.now() + waitMs).toISOString()
      hub.broadcast('engine_status', this.status)
      console.log(
        `[engine:${this.userId}] Markets closed — next open in ${Math.round(waitMs / 60000)}min`
      )
      this._timer = setTimeout(() => this._scheduleTick(), waitMs)
      return
    }

    this._nextCycleAt = new Date(Date.now() + this.userConfig.tradeIntervalMs).toISOString()
    this._runCycle()
      .then(() => {
        if (!this._running) return
        this._timer = setTimeout(() => this._scheduleTick(), this.userConfig.tradeIntervalMs)
      })
      .catch((err) => {
        console.error(`[engine:${this.userId}] Unhandled cycle error:`, (err as Error).message)
        if (this._running) {
          this._timer = setTimeout(() => this._scheduleTick(), this.userConfig.tradeIntervalMs)
        }
      })
  }
}

// ── Engine registry ────────────────────────────────────────────────────────
// One EngineService instance per user.

const _engines = new Map<string, EngineService>()

export function getEngine(userId: string): EngineService | null {
  return _engines.get(userId) ?? null
}

export function createEngine(
  userId: string,
  t212: Trading212Client,
  anthropicApiKey: string,
  userConfig: UserConfig
): EngineService {
  let engine = _engines.get(userId)
  if (!engine) {
    engine = new EngineService(userId, t212, anthropicApiKey, userConfig)
    _engines.set(userId, engine)
  }
  return engine
}

export function getAllEngineStatuses(): EngineStatus[] {
  return [..._engines.values()].map((e) => e.status)
}
