import { useSearchParams } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Global market filter persisted in the URL search param `?market=`.
 *
 * - `null` (param omitted) means "ALL markets" — used by aggregate views.
 * - A specific market code (e.g. 'NYSE', 'XETRA') restricts the view.
 *
 * Pages read `market` and pass it to `api.*` calls. The header MarketDropdown
 * mutates the param; back/forward and bookmarks preserve the choice.
 */
export function useMarketFilter() {
  const [params, setParams] = useSearchParams()
  const market = params.get('market')

  const setMarket = useCallback(
    (m: string | null) => {
      const next = new URLSearchParams(params)
      if (m === null) next.delete('market')
      else next.set('market', m)
      setParams(next, { replace: true })
    },
    [params, setParams]
  )

  return { market, setMarket }
}
