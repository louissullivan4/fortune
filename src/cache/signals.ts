import type { TickerSignal } from '../strategy/signals.js'

interface SignalCache {
  data: TickerSignal[]
  computedAt: string
}

let _cache: SignalCache | null = null
const TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getCachedSignals(): SignalCache | null {
  return _cache
}

export function setCachedSignals(signals: TickerSignal[]): void {
  _cache = { data: signals, computedAt: new Date().toISOString() }
}

export function isCacheFresh(): boolean {
  if (!_cache) return false
  return Date.now() - new Date(_cache.computedAt).getTime() < TTL_MS
}
