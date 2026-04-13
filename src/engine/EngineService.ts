import { isMarketOpen, nextOpenMs } from './scheduler.js'
import { decide } from './brain.js'
import { validateOrder } from './riskmanager.js'
import {
  reconcileAiPositions,
  getOpenAiPositions,
  getClosedAiPositions,
  closeAiPosition,
  closeAllAiPositions,
  openAiPosition,
  updateHighWaterMark,
  getDailyOpenValue,
  upsertDailySnapshot,
  logDecision,
  logOrder,
  logAiUsage,
  getRecentDecisions,
} from '../analytics/journal.js'
import { Trading212Client, type PortfolioSnapshot } from '../api/trading212.js'
import { getAllHistories } from '../api/marketdata.js'
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
}

// ── Signal fingerprinting ──────────────────────────────────────────────────

interface SignalFingerprint {
  fingerprint: string
  lastDecisionAction: 'buy' | 'sell' | 'hold'
}

function pplBucket(pctChange: number): string {
  if (pctChange <= -5) return 'stop'
  if (pctChange <= -1) return 'down'
  if (pctChange < 1) return 'flat'
  if (pctChange < 5) return 'up'
  return 'profit'
}

function computeSignalFingerprint(signals: TickerSignal[]): string {
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
  private _sessionCashCommitted = 0
  private _lastKnownFreeCash: number | null = null
  private _cycleRunning = false

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
      const liveSnapshot = await this.t212.getPortfolioSnapshot()
      const liveTickers = new Set(liveSnapshot.positions.map((p) => p.ticker))
      for (const pos of openPositions) {
        if (!liveTickers.has(pos.ticker)) {
          await closeAiPosition(pos.ticker, null, new Date().toISOString(), this.userId)
          console.log(`[engine:${this.userId}] ${pos.ticker} not in T212 — marked closed`)
        }
      }
    }
    console.log(`[engine:${this.userId}] Ready. Universe: ${this.userConfig.tradeUniverse.join(', ')}`)
  }

  // ── Adjusted snapshot (session cash accounting) ─────────────────────────

  private _adjustedSnapshot(snapshot: PortfolioSnapshot): PortfolioSnapshot {
    if (this._lastKnownFreeCash !== null && snapshot.cash.free < this._lastKnownFreeCash) {
      const settled = this._lastKnownFreeCash - snapshot.cash.free
      this._sessionCashCommitted = Math.max(0, this._sessionCashCommitted - settled)
    }
    this._lastKnownFreeCash = snapshot.cash.free
    const effectiveFree = Math.max(0, snapshot.cash.free - this._sessionCashCommitted)
    return { ...snapshot, cash: { ...snapshot.cash, free: effectiveFree } }
  }

  // ── Hard exit check ─────────────────────────────────────────────────────

  private async _checkHardExits(
    snapshot: PortfolioSnapshot,
    timestamp: string
  ): Promise<number> {
    const openPositions = await getOpenAiPositions(this.userId)
    if (openPositions.length === 0) return 0

    let exitsPlaced = 0
    const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10), this.userId)
    const TRAIL_ACTIVATION_PCT = 1.5
    const TRAIL_STOP_PCT = 3.0

    const seenTickers = new Set<string>()
    for (const pos of openPositions) {
      if (seenTickers.has(pos.ticker)) continue
      seenTickers.add(pos.ticker)
      if (!pos.entryPrice) continue
      const live = snapshot.positions.find((p) => p.ticker === pos.ticker)
      if (!live) continue

      await updateHighWaterMark(pos.ticker, live.currentPrice, this.userId)
      const hwm = Math.max(pos.highWaterMark ?? pos.entryPrice, live.currentPrice)

      const pctFromEntry = ((live.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
      const pctFromPeak = ((live.currentPrice - hwm) / hwm) * 100

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
        { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: live.currentPrice },
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
        estimatedPrice: live.currentPrice,
        reasoning: reason,
        signalsJson: '[]',
        portfolioJson: JSON.stringify({ totalValue: snapshot.totalValue, cash: snapshot.cash.free }),
        userId: this.userId,
      })

      try {
        const order = await this.t212.placeMarketOrder(pos.ticker, sellQty, 'sell')
        await closeAllAiPositions(pos.ticker, live.currentPrice, timestamp, this.userId)
        this.t212.invalidatePortfolioCache()
        await logOrder({
          decisionId,
          t212OrderId: order.id,
          status: order.status,
          fillPrice: live.currentPrice,
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

  // ── Stagnant exit check ─────────────────────────────────────────────────

  private async _checkStagnantExits(
    snapshot: PortfolioSnapshot,
    signals: TickerSignal[],
    timestamp: string
  ): Promise<number> {
    if (!this.userConfig.stagnantExitEnabled) return 0

    const openPositions = await getOpenAiPositions(this.userId)
    if (openPositions.length === 0) return 0

    const heldTickers = new Set(openPositions.map((p) => p.ticker))
    const hasBetterOpportunity = signals.some(
      (s) => (s.signal === 'buy' || s.signal === 'strong_buy') && !heldTickers.has(s.ticker)
    )
    if (!hasBetterOpportunity) return 0

    const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10), this.userId)
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
        minutesHeld >= this.userConfig.stagnantTimeMinutes &&
        Math.abs(pctFromEntry) < this.userConfig.stagnantRangePct * 100
      const atBreakEven = currentPrice >= pos.entryPrice

      if (!isStagnant || !atBreakEven) continue

      const sellQty = live.quantity
      const risk = await validateOrder(
        { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: currentPrice },
        snapshot,
        dailyOpen ?? snapshot.totalValue,
        this.t212,
        this.userConfig
      )
      if (!risk.allowed) continue

      const direction = pctFromEntry >= 0 ? '+' : ''
      const reason =
        `Stagnant exit: held ${minutesHeld.toFixed(0)} minutes with only ` +
        `${direction}${Math.abs(pctFromEntry).toFixed(2)}% movement from entry €${pos.entryPrice.toFixed(2)}. ` +
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
        userId: this.userId,
      })

      try {
        const order = await this.t212.placeMarketOrder(pos.ticker, sellQty, 'sell')
        await closeAllAiPositions(pos.ticker, currentPrice, timestamp, this.userId)
        this.t212.invalidatePortfolioCache()
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

  // ── Main cycle ─────────────────────────────────────────────────────────

  private async _cycle(): Promise<void> {
    if (!isMarketOpen()) {
      console.log(`[engine:${this.userId}] Markets closed — skipping cycle`)
      return
    }

    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const timestamp = now.toISOString()

    console.log(`\n[engine:${this.userId}] ${timestamp} — running cycle`)

    const snapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
    const pendingNote =
      this._sessionCashCommitted > 0
        ? ` (€${this._sessionCashCommitted.toFixed(2)} pending settlement)`
        : ''
    console.log(
      `[engine:${this.userId}] Portfolio: €${snapshot.totalValue.toFixed(2)} total, €${snapshot.cash.free.toFixed(2)} free cash${pendingNote}`
    )

    const exitsPlaced = await this._checkHardExits(snapshot, timestamp)
    if (exitsPlaced > 0) {
      const freshSnapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
      Object.assign(snapshot, freshSnapshot)
    }

    const dailyOpenValue = (await getDailyOpenValue(dateStr, this.userId)) ?? snapshot.totalValue

    const drawdown = (dailyOpenValue - snapshot.totalValue) / dailyOpenValue
    if (drawdown > this.userConfig.dailyLossLimitPct) {
      console.log(
        `[engine:${this.userId}] Daily loss limit hit (${(drawdown * 100).toFixed(1)}%) — halting for today`
      )
      return
    }

    console.log(
      `[engine:${this.userId}] Fetching price history for ${this.userConfig.tradeUniverse.length} tickers...`
    )
    const histories = await getAllHistories(this.userConfig.tradeUniverse, 90)

    const botTickers = new Set((await getOpenAiPositions(this.userId)).map((p) => p.ticker))
    const botPositions = snapshot.positions.filter((p) => botTickers.has(p.ticker))
    const manualTickers = new Set(
      snapshot.positions.map((p) => p.ticker).filter((t) => !botTickers.has(t))
    )
    const buyUniverse = this.userConfig.tradeUniverse.filter(
      (t) => !botTickers.has(t) && !manualTickers.has(t)
    )
    if (botTickers.size > 0) {
      console.log(
        `[engine:${this.userId}] Excluding bot-held tickers from buy universe: ${[...botTickers].join(', ')}`
      )
    }
    if (manualTickers.size > 0) {
      console.log(
        `[engine:${this.userId}] Excluding manually held tickers from buy universe: ${[...manualTickers].join(', ')}`
      )
    }
    const signals = generateSignals(buyUniverse, histories, botPositions)
    const actionable = signals.filter((s) => s.signal !== 'hold').length
    console.log(
      `[engine:${this.userId}] Signals: ${signals.length} tickers, ${actionable} actionable`
    )

    const aiPositionsValue = botPositions.reduce(
      (sum, p) => sum + p.currentPrice * p.quantity,
      0
    )
    const aiValue = snapshot.cash.free + aiPositionsValue

    await upsertDailySnapshot(dateStr, snapshot.totalValue, aiValue, this.userId)

    const stagnantExits = await this._checkStagnantExits(snapshot, signals, timestamp)
    if (stagnantExits > 0) {
      const freshSnapshot = this._adjustedSnapshot(await this.t212.getPortfolioSnapshot())
      Object.assign(snapshot, freshSnapshot)
      this._lastSignalState = null
      console.log(`[engine:${this.userId}] ${stagnantExits} stagnant exit(s)`)
    }

    const currentFingerprint = computeSignalFingerprint(signals)
    const lastState = this._lastSignalState
    const shouldSkipAi =
      lastState !== null &&
      lastState.lastDecisionAction === 'hold' &&
      lastState.fingerprint === currentFingerprint

    if (shouldSkipAi) {
      console.log(`[engine:${this.userId}] Signals unchanged since last hold — skipping AI call`)
      return
    }

    const recentDecisions = await getRecentDecisions(this.userId, 5)
    console.log(`[engine:${this.userId}] Asking Claude for decision...`)
    const botSnapshot = { ...snapshot, positions: botPositions }
    const { decision, usage } = await decide(
      signals,
      botSnapshot,
      recentDecisions,
      this.anthropicApiKey,
      this.t212,
      this.userConfig
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
        dailyOpenValue,
        this.t212,
        this.userConfig
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
          this._sessionCashCommitted += decision.quantity * estimatedPrice
          await openAiPosition(
            decision.ticker,
            decision.quantity,
            estimatedPrice,
            timestamp,
            this.userId
          )
        } else if (decision.action === 'sell') {
          await closeAllAiPositions(decision.ticker, estimatedPrice, timestamp, this.userId)
        }
        this.t212.invalidatePortfolioCache()
        console.log(`[engine:${this.userId}] Order placed: ${orderResult.id} (${orderResult.status})`)
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
          await closeAllAiPositions(decision.ticker, estimatedPrice, timestamp, this.userId)
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
    try {
      await this._cycle()
      this._cycleCount++
    } catch (err) {
      const msg = (err as Error).message
      console.error(`[engine:${this.userId}] Cycle error:`, msg)
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

    this._nextCycleAt = new Date(
      Date.now() + this.userConfig.tradeIntervalMs
    ).toISOString()
    this._runCycle()
      .then(() => {
        if (!this._running) return
        this._timer = setTimeout(
          () => this._scheduleTick(),
          this.userConfig.tradeIntervalMs
        )
      })
      .catch((err) => {
        console.error(
          `[engine:${this.userId}] Unhandled cycle error:`,
          (err as Error).message
        )
        if (this._running) {
          this._timer = setTimeout(
            () => this._scheduleTick(),
            this.userConfig.tradeIntervalMs
          )
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
