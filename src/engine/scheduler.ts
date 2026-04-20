// Legacy single-market helpers kept for backwards-compat with callers that
// are not yet multi-market aware. New code should import from `./markets.js`
// and pass the exchange explicitly.

import { isMarketOpen as _isOpen, nextOpenMs as _nextOpenMs } from './markets.js'

export function isMarketOpen(): boolean {
  return _isOpen('NYSE')
}

export function nextOpenMs(): number {
  return _nextOpenMs('NYSE')
}
