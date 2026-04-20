import { isMarketOpen, nextOpenMs, type ExchangeCode } from './markets.js'
import { decide } from './brain.js'
import { validateOrder } from './riskmanager.js'
import {
  reconcileAiPositions,
  getOpenAiPositions,
  closeAiPosition,
  closeAllAiPositions,
  openAiPosition,
  updateHighWaterMark,
  getDailyOpenValue,
  upsertDailySnapshot,
  upsertDailyMarketSnapshot,
  getDailyMarketOpenValue,
  getPreviousDayMarketOpenValue,
  logDecision,
  logOrder,
  logAiUsage,
  getRecentDecisions,
  type AiPosition,
} from '../analytics/journal.js'
import { Trading212Client, type PortfolioSnapshot, type T212Position } from '../api/trading212.js'
import { getAllHistories } from '../api/marketdata.js'
import { generateSignals } from '../strategy/signals.js'
import type { TickerSignal } from '../strategy/signals.js'
import { hub } from '../ws/hub.js'
import type { MarketConfig, UserConfig } from '../types/user.js'

export interface EngineStatus {
  running: boolean
  startedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  cycleCount: number
  marketOpen: boolean
  activeMarkets: ExchangeCode[]
  mode: string
  /** Union of per-market intervals — for UI display only. */
  intervalMs: number
  userId: string
  pendingSettlement: number
}

// ── Constants ─────────────────────────────────────────────────────────────

const CASH_BUFFER_EUR = 5
const MIN_DEPLOYABLE_EUR = 6
const TICKER_COOLDOWN_MS = 20 * 60 * 1_000
const TRAIL_ACTIVATION_PCT = 0.8
const TRAIL_STOP_PCT = 0.4
const CASH_COMMITMENT_TTL_MS = 90_000
const MAX_FINGERPRINT_SKIPS = 4

// ── Helpers ────────────────────────────────────────────────────────────────

function enabledMarkets(cfg: UserConfig): MarketConfig[] {
  return cfg.markets.filter((m) => m.enabled)
}

function activeMarketsNow(cfg: UserConfig, now: Date = new Date()): ExchangeCode[] {
  return enabledMarkets(cfg)
    .filter((m) => isMarketOpen(m.exchange, now, { from: m.activeFrom, to: m.activeTo }))
    .map((m) => m.exchange)
}

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

// ── Per-market state ───────────────────────────────────────────────────────

class PerMarketState {
  timer: ReturnType<typeof setTimeout> | null = null
  lastCycleAt: string | null = null
  nextCycleAt: string | null = null
  cycleCount = 0
  cycleRunning = false
  lastSignalState: SignalFingerprint | null = null
  cashCommitments: Array<{ amount: number; expiresAt: number }> = []
  lastKnownFreeCash: number | null = null
  recentlyClosedTickers = new Map<string, number>()
  lastSeenPrices = new Map<string, number>()
  consecutiveFingerprintSkips = 0

  sessionCashCommitted(): number {
    const now = Date.now()
    return this.cashCommitments.filter((c) => c.expiresAt > now).reduce((s, c) => s + c.amount, 0)
  }
}

// ── Per-user EngineService ─────────────────────────────────────────────────

export class EngineService {
  private _running = false
  private _startedAt: string | null = null
  private _initialized = false
  private _states = new Map<ExchangeCode, PerMarketState>()

  constructor(
    public readonly userId: string,
    public readonly t212: Trading212Client,
    private anthropicApiKey: string,
    private userConfig: UserConfig
  ) {}

  updateConfig(config: UserConfig): void {
    const oldEnabled = new Set(enabledMarkets(this.userConfig).map((m) => m.exchange))
    this.userConfig = config
    const newEnabled = new Set(enabledMarkets(config).map((m) => m.exchange))

    // Stop any market that was disabled.
    for (const code of oldEnabled) {
      if (!newEnabled.has(code)) {
        const s = this._states.get(code)
        if (s?.timer) clearTimeout(s.timer)
        if (s) s.nextCycleAt = null
      }
    }
    // Start any newly-enabled market if the engine is running.
    if (this._running) {
      for (const code of newEnabled) {
        if (!oldEnabled.has(code) || !this._states.get(code)?.timer) {
          this._ensureState(code)
          this._scheduleMarketTick(code)
        }
      }
    }
    hub.broadcast('engine_status', this.status)
  }

  private _ensureState(exchange: ExchangeCode): PerMarketState {
    let s = this._states.get(exchange)
    if (!s) {
      s = new PerMarketState()
      this._states.set(exchange, s)
    }
    return s
  }

  get status(): EngineStatus {
    const active = activeMarketsNow(this.userConfig)
    const enabled = enabledMarkets(this.userConfig)
    const intervals = enabled.map((m) => m.tradeIntervalMs)
    const totalPending = [...this._states.values()].reduce(
      (sum, s) => sum + s.sessionCashCommitted(),
      0
    )
    const lastCycleAt =
      [...this._states.values()]
        .map((s) => s.lastCycleAt)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null
    const nextCycleAt =
      [...this._states.values()]
        .map((s) => s.nextCycleAt)
        .filter((x): x is string => !!x)
        .sort()
        .at(0) ?? null
    const cycleCount = [...this._states.values()].reduce((s, ps) => s + ps.cycleCount, 0)
    return {
      running: this._running,
      startedAt: this._startedAt,
      lastCycleAt,
      nextCycleAt,
      cycleCount,
      marketOpen: active.length > 0,
      activeMarkets: active,
      mode: this.t212['mode'] as string,
      intervalMs: intervals.length > 0 ? Math.min(...intervals) : 0,
      userId: this.userId,
      pendingSettlement: totalPending,
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

    for (const m of enabledMarkets(this.userConfig)) {
      this._ensureState(m.exchange)
      this._scheduleMarketTick(m.exchange)
    }
    hub.broadcast('engine_status', this.status)
    return this.status
  }

  stop(): EngineStatus {
    this._running = false
    for (const s of this._states.values()) {
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      s.nextCycleAt = null
    }
    hub.broadcast('engine_status', this.status)
    return this.status
  }

  /** Force-run a cycle on the first currently-open enabled market (or first enabled). */
  async triggerCycle(): Promise<EngineStatus> {
    const active = activeMarketsNow(this.userConfig)
    const target = active[0] ?? enabledMarkets(this.userConfig)[0]?.exchange
    if (target) await this._runCycle(target)
    return this.status
  }

  // ── Initialization ─────────────────────────────────────────────────────

  private async _initialize(): Promise<void> {
    console.log(`[engine:${this.userId}] Initializing...`)
    const { inserted } = await reconcileAiPositions(this.userId)
    if (inserted > 0) console.log(`[engine:${this.userId}] Reconciled ${inserted} position(s)`)

    const instruments = await this.t212.getInstruments()
    const validUniverse = this.userConfig.tradeUniverse.filter((entry) => {
      if (instruments.has(entry.ticker)) return true
      console.warn(`[engine:${this.userId}] "${entry.ticker}" not in T212 — removing from universe`)
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
    }
    console.log(
      `[engine:${this.userId}] Ready. Universe: ${this.userConfig.tradeUniverse
        .map((e) => `${e.ticker}@${e.exchange}`)
        .join(', ')}`
    )
  }

  // ── Per-market budget-scoped snapshot ───────────────────────────────────

  private _scopedSnapshot(
    snapshot: PortfolioSnapshot,
    market: MarketConfig,
    state: PerMarketState,
    marketTickers: Set<string>
  ): {
    raw: PortfolioSnapshot
    scoped: PortfolioSnapshot
    botCash: number
    aiPositionsValue: number
  } {
    const now = Date.now()
    state.cashCommitments = state.cashCommitments.filter((c) => c.expiresAt > now)

    if (state.lastKnownFreeCash !== null && snapshot.cash.free < state.lastKnownFreeCash) {
      let settled = state.lastKnownFreeCash - snapshot.cash.free
      const remaining: Array<{ amount: number; expiresAt: number }> = []
      for (const c of state.cashCommitments) {
        if (settled >= c.amount) settled -= c.amount
        else if (settled > 0) {
          remaining.push({ amount: c.amount - settled, expiresAt: c.expiresAt })
          settled = 0
        } else remaining.push(c)
      }
      state.cashCommitments = remaining
    }
    state.lastKnownFreeCash = snapshot.cash.free

    // Market-scoped positions — only ones on this exchange AND in bot's ownership list.
    const marketPositions = snapshot.positions.filter((p) => marketTickers.has(p.ticker))
    const aiPositionsValue = marketPositions.reduce(
      (sum, p) => sum + p.currentPrice * p.quantity,
      0
    )
    const marketBudgetRemaining = Math.max(0, market.maxBudgetEur - aiPositionsValue)
    const committed = state.sessionCashCommitted()
    const physicalFree = Math.max(0, snapshot.cash.free - committed)
    const botCash = Math.min(marketBudgetRemaining, physicalFree)

    console.log(
      `[engine:${this.userId}/${market.exchange}] Budget: cap=€${market.maxBudgetEur.toFixed(2)} inPositions=€${aiPositionsValue.toFixed(2)} remaining=€${marketBudgetRemaining.toFixed(2)} freeCash=€${snapshot.cash.free.toFixed(2)} committed=€${committed.toFixed(2)} → botCash=€${botCash.toFixed(2)}`
    )

    return {
      raw: snapshot,
      scoped: {
        ...snapshot,
        positions: marketPositions,
        cash: { ...snapshot.cash, free: botCash },
        totalValue: aiPositionsValue + botCash,
        totalPpl: marketPositions.reduce((s, p) => s + p.ppl, 0),
      },
      botCash,
      aiPositionsValue,
    }
  }

  private _purgeStaleCooldowns(state: PerMarketState): void {
    const cutoff = Date.now() - TICKER_COOLDOWN_MS
    for (const [ticker, closedAt] of state.recentlyClosedTickers) {
      if (closedAt < cutoff) state.recentlyClosedTickers.delete(ticker)
    }
  }

  // ── Hard exits (scoped to market) ───────────────────────────────────────

  private async _checkHardExits(
    snapshot: PortfolioSnapshot,
    market: MarketConfig,
    marketTickers: Set<string>,
    state: PerMarketState,
    timestamp: string
  ): Promise<number> {
    const allOpen = await getOpenAiPositions(this.userId)
    const openPositions = allOpen.filter((p) => marketTickers.has(p.ticker))
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

      const stopLossPct = market.stopLossPct * 100
      const takeProfitPct = market.takeProfitPct * 100
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

      console.log(`[engine:${this.userId}/${market.exchange}] Hard exit — ${pos.ticker}: ${reason}`)

      const sellQty = live.quantity
      const scopedSnapshot: PortfolioSnapshot = {
        ...snapshot,
        positions: snapshot.positions.filter((p) => marketTickers.has(p.ticker)),
      }
      const risk = await validateOrder(
        {
          action: 'sell',
          ticker: pos.ticker,
          quantity: sellQty,
          estimatedPrice: currentPriceEur,
        },
        scopedSnapshot,
        dailyOpen ?? snapshot.totalValue,
        this.t212,
        market
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
        state.recentlyClosedTickers.set(pos.ticker, Date.now())
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

  // ── Stagnant exits ──────────────────────────────────────────────────────

  private async _identifyStagnantCandidates(
    snapshot: PortfolioSnapshot,
    signals: TickerSignal[],
    market: MarketConfig,
    marketTickers: Set<string>,
    state: PerMarketState
  ): Promise<StagnantCandidate[]> {
    if (!market.stagnantExitEnabled) return []

    const allOpen = await getOpenAiPositions(this.userId)
    const openPositions = allOpen.filter((p) => marketTickers.has(p.ticker))
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

      const isStagnant =
        minutesHeld >= market.stagnantTimeMinutes &&
        Math.abs(pctFromEntry) < market.stagnantRangePct * 100
      const atBreakEven = currentPrice >= pos.entryPrice
      const hwm = pos.highWaterMark ?? pos.entryPrice
      const positionRanUp = hwm > pos.entryPrice * (1 + market.stagnantRangePct)
      const lastPrice = state.lastSeenPrices.get(pos.ticker)
      const isTrendingUp = lastPrice !== undefined && currentPrice > lastPrice

      if (!isStagnant || !atBreakEven || positionRanUp || isTrendingUp) continue

      const direction = pctFromEntry >= 0 ? '+' : ''
      const reason =
        `Stagnant exit: held ${minutesHeld.toFixed(0)} minutes with only ` +
        `${direction}${Math.abs(pctFromEntry).toFixed(2)}% movement from entry €${pos.entryPrice.toFixed(2)}. ` +
        `Rotating capital to better opportunities on ${market.exchange}.`

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

  private async _executeStagnantExits(
    candidates: StagnantCandidate[],
    aiSoldTicker: string | null,
    snapshot: PortfolioSnapshot,
    market: MarketConfig,
    marketTickers: Set<string>,
    state: PerMarketState,
    timestamp: string
  ): Promise<number> {
    const dailyOpen = await getDailyOpenValue(timestamp.slice(0, 10), this.userId)
    let exitsPlaced = 0

    for (const { pos, currentPrice, sellQty, reason } of candidates) {
      if (pos.ticker === aiSoldTicker) {
        console.log(
          `[engine:${this.userId}/${market.exchange}] Stagnant exit for ${pos.ticker} deferred — AI already sold`
        )
        continue
      }

      const scopedSnapshot: PortfolioSnapshot = {
        ...snapshot,
        positions: snapshot.positions.filter((p) => marketTickers.has(p.ticker)),
      }
      const risk = await validateOrder(
        { action: 'sell', ticker: pos.ticker, quantity: sellQty, estimatedPrice: currentPrice },
        scopedSnapshot,
        dailyOpen ?? snapshot.totalValue,
        this.t212,
        market
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
        state.recentlyClosedTickers.set(pos.ticker, Date.now())
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

  private _updateLastSeenPrices(snapshot: PortfolioSnapshot, state: PerMarketState): void {
    for (const pos of snapshot.positions) state.lastSeenPrices.set(pos.ticker, pos.currentPrice)
  }

  // ── Per-market cycle ────────────────────────────────────────────────────

  private async _cycleForMarket(exchange: ExchangeCode): Promise<void> {
    const market = enabledMarkets(this.userConfig).find((m) => m.exchange === exchange)
    if (!market) return

    const state = this._ensureState(exchange)
    const now = new Date()
    if (!isMarketOpen(exchange, now, { from: market.activeFrom, to: market.activeTo })) {
      console.log(`[engine:${this.userId}/${exchange}] Outside active window — skipping cycle`)
      return
    }

    const dateStr = now.toISOString().slice(0, 10)
    const timestamp = now.toISOString()

    this._purgeStaleCooldowns(state)
    console.log(`\n[engine:${this.userId}/${exchange}] ${timestamp} — running cycle`)

    const rawSnapshot = await this.t212.getPortfolioSnapshot()

    // This market's tickers (AI-owned + in universe, to stay within our scope)
    const marketUniverseTickers = new Set(
      this.userConfig.tradeUniverse.filter((e) => e.exchange === exchange).map((e) => e.ticker)
    )
    const allOpen = await getOpenAiPositions(this.userId)
    const marketBotTickers = new Set(
      allOpen.filter((p) => marketUniverseTickers.has(p.ticker)).map((p) => p.ticker)
    )
    // marketTickers = everything under this market's purview (positions + universe)
    const marketTickers = new Set<string>([...marketUniverseTickers, ...marketBotTickers])

    const { scoped, botCash, aiPositionsValue } = this._scopedSnapshot(
      rawSnapshot,
      market,
      state,
      marketTickers
    )

    // Seed daily snapshots (account-wide + per-market).
    await upsertDailySnapshot(
      dateStr,
      rawSnapshot.totalValue,
      botCash + aiPositionsValue,
      this.userId
    )
    await upsertDailyMarketSnapshot(this.userId, dateStr, exchange, botCash + aiPositionsValue)

    console.log(`[engine:${this.userId}/${exchange}] Checking hard exits...`)
    const exitsPlaced = await this._checkHardExits(
      rawSnapshot,
      market,
      marketTickers,
      state,
      timestamp
    )
    let snapshot = rawSnapshot
    if (exitsPlaced > 0) {
      console.log(
        `[engine:${this.userId}/${exchange}] ${exitsPlaced} hard exit(s) placed — refreshing snapshot`
      )
      snapshot = await this.t212.getPortfolioSnapshot()
    }

    // Market-local daily loss halt.
    const marketDailyOpenValue =
      (await getDailyMarketOpenValue(this.userId, dateStr, exchange)) ?? botCash + aiPositionsValue
    const previousMarketValue =
      (await getPreviousDayMarketOpenValue(this.userId, dateStr, exchange)) ?? marketDailyOpenValue
    const aiDrawdown =
      previousMarketValue > 0
        ? (previousMarketValue - (botCash + aiPositionsValue)) / previousMarketValue
        : 0
    if (aiDrawdown > market.dailyLossLimitPct) {
      console.log(
        `[engine:${this.userId}/${exchange}] Daily loss limit hit (${(aiDrawdown * 100).toFixed(1)}% vs yesterday) — halting this market for today`
      )
      return
    }

    console.log(
      `[engine:${this.userId}/${exchange}] Fetching price history for ${marketUniverseTickers.size} tickers...`
    )
    const histories = await getAllHistories([...marketUniverseTickers], 90)

    const manualTickers = new Set(
      snapshot.positions
        .map((p) => p.ticker)
        .filter((t) => marketTickers.has(t) && !marketBotTickers.has(t))
    )
    const coolingTickers = new Set(
      [...state.recentlyClosedTickers.keys()].filter(
        (t) => Date.now() - (state.recentlyClosedTickers.get(t) ?? 0) < TICKER_COOLDOWN_MS
      )
    )
    const buyUniverse = [...marketUniverseTickers].filter(
      (t) => !marketBotTickers.has(t) && !manualTickers.has(t) && !coolingTickers.has(t)
    )

    const botPositions = snapshot.positions.filter((p) => marketBotTickers.has(p.ticker))
    const signals = generateSignals(buyUniverse, histories, botPositions)
    const actionable = signals.filter((s) => s.signal !== 'hold').length
    console.log(
      `[engine:${this.userId}/${exchange}] Signals: ${signals.length} tickers, ${actionable} actionable`
    )

    const stagnantCandidates = await this._identifyStagnantCandidates(
      snapshot,
      signals,
      market,
      marketTickers,
      state
    )

    const currentFingerprint = computeSignalFingerprint(signals, botCash)
    const lastState = state.lastSignalState
    const shouldSkipAi =
      lastState !== null &&
      lastState.lastDecisionAction === 'hold' &&
      lastState.fingerprint === currentFingerprint &&
      stagnantCandidates.length === 0

    if (shouldSkipAi) {
      state.consecutiveFingerprintSkips++
      if (state.consecutiveFingerprintSkips < MAX_FINGERPRINT_SKIPS) {
        console.log(
          `[engine:${this.userId}/${exchange}] Signals unchanged — skipping AI call (${state.consecutiveFingerprintSkips}/${MAX_FINGERPRINT_SKIPS})`
        )
        return
      }
      console.log(
        `[engine:${this.userId}/${exchange}] Signals unchanged for ${MAX_FINGERPRINT_SKIPS} cycles — forcing AI re-check`
      )
      state.consecutiveFingerprintSkips = 0
    } else {
      state.consecutiveFingerprintSkips = 0
    }

    const cashBuffer = CASH_BUFFER_EUR
    const deployable = botCash - cashBuffer
    if (deployable < MIN_DEPLOYABLE_EUR && stagnantCandidates.length === 0) {
      const reason = `Cash-constrained hold on ${exchange}: €${botCash.toFixed(2)} bot cash (budget €${market.maxBudgetEur} − €${aiPositionsValue.toFixed(2)} in positions), €${deployable.toFixed(2)} deployable after €${cashBuffer} buffer`
      console.log(`[engine:${this.userId}/${exchange}] ${reason}`)
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
          aiValue: botCash + aiPositionsValue,
          cash: snapshot.cash.free,
        }),
        userId: this.userId,
      })
      state.lastSignalState = { fingerprint: currentFingerprint, lastDecisionAction: 'hold' }
      return
    }

    const recentDecisions = await getRecentDecisions(this.userId, 5)
    console.log(`[engine:${this.userId}/${exchange}] Asking Claude for decision...`)
    const botSnapshot: PortfolioSnapshot = {
      ...scoped,
      positions: botPositions,
      cash: { ...scoped.cash, free: botCash },
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
      market,
      stagnantInfo
    )
    console.log(
      `[engine:${this.userId}/${exchange}] Claude decision: ${decision.action.toUpperCase()} ${decision.ticker ?? ''}`
    )
    console.log(
      `[engine:${this.userId}/${exchange}] Token usage: ${usage.inputTokens}in / ${usage.outputTokens}out — $${usage.totalCostUsd.toFixed(6)}`
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
        aiValue: botCash + aiPositionsValue,
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

    state.lastSignalState = {
      fingerprint: currentFingerprint,
      lastDecisionAction: decision.action,
    }

    const aiSoldTicker = decision.action === 'sell' && decision.ticker ? decision.ticker : null
    if (stagnantCandidates.length > 0) {
      const stagnantExits = await this._executeStagnantExits(
        stagnantCandidates,
        aiSoldTicker,
        snapshot,
        market,
        marketTickers,
        state,
        timestamp
      )
      if (stagnantExits > 0) {
        snapshot = await this.t212.getPortfolioSnapshot()
        state.lastSignalState = null
      }
    }

    this._updateLastSeenPrices(snapshot, state)

    if (decision.action !== 'hold' && decision.ticker && decision.quantity) {
      const signal = signals.find((s) => s.ticker === decision.ticker)
      const estimatedPriceEur = decision.estimatedPrice ?? signal?.indicators.currentPrice ?? 0

      const risk = await validateOrder(
        {
          action: decision.action,
          ticker: decision.ticker,
          quantity: decision.quantity,
          estimatedPrice: estimatedPriceEur,
        },
        botSnapshot,
        marketDailyOpenValue,
        this.t212,
        market
      )

      if (!risk.allowed) {
        console.log(`[engine:${this.userId}/${exchange}] Risk manager blocked: ${risk.reason}`)
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

      console.log(`[engine:${this.userId}/${exchange}] Submitting order to T212`)
      try {
        const orderResult = await this.t212.placeMarketOrder(
          decision.ticker,
          decision.quantity,
          decision.action
        )

        if (decision.action === 'buy') {
          state.cashCommitments.push({
            amount: decision.quantity * estimatedPriceEur,
            expiresAt: Date.now() + CASH_COMMITMENT_TTL_MS,
          })
          await openAiPosition(
            decision.ticker,
            decision.quantity,
            estimatedPriceEur,
            timestamp,
            this.userId
          )
        } else if (decision.action === 'sell') {
          await closeAllAiPositions(decision.ticker, estimatedPriceEur, timestamp, this.userId)
          state.recentlyClosedTickers.set(decision.ticker, Date.now())
        }
        this.t212.invalidatePortfolioCache()
        this.t212.invalidateOrderHistoryCache()
        console.log(
          `[engine:${this.userId}/${exchange}] Order placed: ${orderResult.id} (${orderResult.status})`
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
        console.error(`[engine:${this.userId}/${exchange}] Order failed: ${msg}`)
        if (decision.action === 'sell' && msg.includes('selling-equity-not-owned')) {
          await closeAllAiPositions(decision.ticker, estimatedPriceEur, timestamp, this.userId)
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

    hub.broadcast('decision', {
      cycleAt: timestamp,
      count: state.cycleCount,
      userId: this.userId,
      exchange,
    })
    hub.broadcast('engine_status', this.status)
  }

  private async _runCycle(exchange: ExchangeCode): Promise<void> {
    const state = this._ensureState(exchange)
    if (state.cycleRunning) {
      console.log(`[engine:${this.userId}/${exchange}] Cycle already in progress — skipping`)
      return
    }
    state.cycleRunning = true
    state.lastCycleAt = new Date().toISOString()
    const cycleStart = Date.now()
    try {
      await this._cycleForMarket(exchange)
      state.cycleCount++
      const elapsed = ((Date.now() - cycleStart) / 1_000).toFixed(1)
      console.log(
        `[engine:${this.userId}/${exchange}] Cycle #${state.cycleCount} complete in ${elapsed}s`
      )
    } catch (err) {
      const msg = (err as Error).message
      const elapsed = ((Date.now() - cycleStart) / 1_000).toFixed(1)
      console.error(`[engine:${this.userId}/${exchange}] Cycle failed after ${elapsed}s: ${msg}`)
      hub.broadcast('toast', {
        message: `${exchange} cycle error: ${msg}`,
        level: 'error',
      })
    } finally {
      state.cycleRunning = false
    }
    hub.broadcast('engine_status', this.status)
  }

  private _scheduleMarketTick(exchange: ExchangeCode): void {
    if (!this._running) return
    const market = enabledMarkets(this.userConfig).find((m) => m.exchange === exchange)
    if (!market) return

    const state = this._ensureState(exchange)
    const now = new Date()

    if (!isMarketOpen(exchange, now, { from: market.activeFrom, to: market.activeTo })) {
      const waitMs = nextOpenMs(exchange, now, { from: market.activeFrom, to: market.activeTo })
      state.nextCycleAt = new Date(Date.now() + waitMs).toISOString()
      hub.broadcast('engine_status', this.status)
      console.log(
        `[engine:${this.userId}/${exchange}] Outside window — next open in ${Math.round(waitMs / 60000)}min`
      )
      state.timer = setTimeout(() => this._scheduleMarketTick(exchange), waitMs)
      return
    }

    state.nextCycleAt = new Date(Date.now() + market.tradeIntervalMs).toISOString()
    this._runCycle(exchange)
      .then(() => {
        if (!this._running) return
        state.timer = setTimeout(() => this._scheduleMarketTick(exchange), market.tradeIntervalMs)
      })
      .catch((err) => {
        console.error(
          `[engine:${this.userId}/${exchange}] Unhandled cycle error:`,
          (err as Error).message
        )
        if (this._running) {
          state.timer = setTimeout(() => this._scheduleMarketTick(exchange), market.tradeIntervalMs)
        }
      })
  }
}

// ── Engine registry ────────────────────────────────────────────────────────

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
