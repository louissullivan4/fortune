import type { TickerSignal } from '../strategy/signals.js'

interface SignalCache {
  data: TickerSignal[]
  computedAt: string
}

// Per-user signal cache
const _caches = new Map<string, SignalCache>()
const TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getCachedSignals(userId: string): SignalCache | null {
  return _caches.get(userId) ?? null
}

export function setCachedSignals(userId: string, signals: TickerSignal[]): void {
  _caches.set(userId, { data: signals, computedAt: new Date().toISOString() })
}

export function isCacheFresh(userId: string): boolean {
  const cache = _caches.get(userId)
  if (!cache) return false
  return Date.now() - new Date(cache.computedAt).getTime() < TTL_MS
}

export function clearCache(userId: string): void {
  _caches.delete(userId)
}
