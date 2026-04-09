import { config } from '../config/index.js'
import { runCycle, isMarketOpen, nextOpenMs } from './scheduler.js'
import {
  reconcileAiPositions,
  getOpenAiPositions,
  closeAiPosition,
} from '../analytics/journal.js'
import { getInstruments, getPortfolioSnapshot } from '../api/trading212.js'
import { hub } from '../ws/hub.js'

export interface EngineStatus {
  running: boolean
  startedAt: string | null
  lastCycleAt: string | null
  nextCycleAt: string | null
  cycleCount: number
  marketOpen: boolean
  mode: string
  intervalMs: number
}

class EngineService {
  private _running = false
  private _startedAt: string | null = null
  private _lastCycleAt: string | null = null
  private _nextCycleAt: string | null = null
  private _cycleCount = 0
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _initialized = false

  get status(): EngineStatus {
    return {
      running: this._running,
      startedAt: this._startedAt,
      lastCycleAt: this._lastCycleAt,
      nextCycleAt: this._nextCycleAt,
      cycleCount: this._cycleCount,
      marketOpen: isMarketOpen(),
      mode: config.trading212Mode,
      intervalMs: config.tradeIntervalMs,
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

  private async _initialize(): Promise<void> {
    console.log('[engine] Initializing...')
    const { inserted } = await reconcileAiPositions()
    if (inserted > 0) console.log(`[engine] Reconciled ${inserted} missing position record(s)`)

    const instruments = await getInstruments()
    const validUniverse = config.tradeUniverse.filter((t) => {
      if (instruments.has(t)) return true
      console.warn(`[engine] "${t}" not found in T212 — removing from universe`)
      return false
    })
    if (validUniverse.length !== config.tradeUniverse.length) {
      ;(config as { tradeUniverse: string[] }).tradeUniverse = validUniverse
    }

    const openPositions = await getOpenAiPositions()
    if (openPositions.length > 0) {
      const liveSnapshot = await getPortfolioSnapshot()
      const liveTickers = new Set(liveSnapshot.positions.map((p) => p.ticker))
      for (const pos of openPositions) {
        if (!liveTickers.has(pos.ticker)) {
          await closeAiPosition(pos.ticker, null, new Date().toISOString())
          console.log(`[engine] ${pos.ticker} no longer in T212 — marked closed`)
        }
      }
    }
    console.log(`[engine] Ready. Universe: ${config.tradeUniverse.join(', ')}`)
  }

  private async _runCycle(): Promise<void> {
    this._lastCycleAt = new Date().toISOString()
    try {
      await runCycle()
      this._cycleCount++
      hub.broadcast('decision', { cycleAt: this._lastCycleAt, count: this._cycleCount })
    } catch (err) {
      const msg = (err as Error).message
      console.error('[engine] Cycle error:', msg)
      hub.broadcast('toast', { message: `Cycle error: ${msg}`, level: 'error' })
    }
    hub.broadcast('engine_status', this.status)
  }

  private _scheduleTick(): void {
    if (!this._running) return

    if (!isMarketOpen()) {
      const waitMs = nextOpenMs()
      this._nextCycleAt = new Date(Date.now() + waitMs).toISOString()
      hub.broadcast('engine_status', this.status)
      console.log(`[engine] Markets closed — next open in ${Math.round(waitMs / 60000)}min`)
      this._timer = setTimeout(() => this._scheduleTick(), waitMs)
      return
    }

    this._nextCycleAt = new Date(Date.now() + config.tradeIntervalMs).toISOString()
    this._runCycle()
      .then(() => {
        if (!this._running) return
        this._timer = setTimeout(() => this._scheduleTick(), config.tradeIntervalMs)
      })
      .catch((err) => {
        console.error('[engine] Unhandled cycle error:', (err as Error).message)
        if (this._running) {
          this._timer = setTimeout(() => this._scheduleTick(), config.tradeIntervalMs)
        }
      })
  }
}

export const engineService = new EngineService()
