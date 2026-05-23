// Market catalog. NYSE and Xetra ship today; add new markets by extending
// MARKETS below. DB stores only identity (markets table); operational details
// (hours, holidays, ticker suffixes) live here so a new market = one file edit.

export interface MarketSpec {
  /** Stable identifier used as PK in the DB and in URLs (?market=NYSE). */
  code: string
  /** Human label for UI. */
  displayName: string
  /** IANA timezone, e.g. 'America/New_York', 'Europe/Berlin'. */
  timezone: string
  /** Instrument denomination currency (positions can still report fxRate). */
  currency: string
  /** Local-time market open as minutes from midnight (9:30 → 570). */
  openMinutesLocal: number
  /** Local-time market close as minutes from midnight (16:00 → 960). */
  closeMinutesLocal: number
  /** Holidays as 'YYYY-MM-DD' in the market's local timezone. */
  holidays: ReadonlySet<string>
  /**
   * T212 ticker suffixes assigned to this market. Used to filter portfolio
   * snapshots so each market engine only sees its own positions, and to
   * detect a ticker's market when one isn't supplied explicitly.
   */
  t212TickerSuffixes: readonly string[]
  /** Map a T212 ticker to the Yahoo Finance symbol used for OHLCV history. */
  toYahooSymbol(t212Ticker: string): string
}

const NYSE_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
])

// Xetra (Frankfurt) follows the TARGET2 settlement calendar. Source:
// Deutsche Börse 2025-2027 trading calendars. Half-days (Dec 24, Dec 31)
// are treated as closed — the engine cycle would not fit a meaningful
// trading window in the abbreviated 09:00-14:00 session.
const XETRA_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-04-18',
  '2025-04-21',
  '2025-05-01',
  '2025-12-24',
  '2025-12-25',
  '2025-12-26',
  '2025-12-31',
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-01',
  '2026-12-24',
  '2026-12-25',
  '2026-12-28',
  '2026-12-31',
  '2027-01-01',
  '2027-03-26',
  '2027-03-29',
  '2027-05-01',
  '2027-12-24',
  '2027-12-27',
  '2027-12-28',
  '2027-12-31',
])

export const NYSE: MarketSpec = {
  code: 'NYSE',
  displayName: 'NYSE',
  timezone: 'America/New_York',
  currency: 'USD',
  openMinutesLocal: 9 * 60 + 30,
  closeMinutesLocal: 16 * 60,
  holidays: NYSE_HOLIDAYS,
  t212TickerSuffixes: ['_US_EQ'],
  toYahooSymbol(t212Ticker: string): string {
    // T212 US tickers are e.g. AAPL_US_EQ → Yahoo wants bare AAPL.
    return t212Ticker.replace(/_[A-Z]+_[A-Z]+$/, '').replace(/_[A-Z]+$/, '')
  },
}

export const XETRA: MarketSpec = {
  code: 'XETRA',
  displayName: 'Xetra',
  timezone: 'Europe/Berlin',
  currency: 'EUR',
  openMinutesLocal: 9 * 60,
  closeMinutesLocal: 17 * 60 + 30,
  holidays: XETRA_HOLIDAYS,
  // T212 Xetra tickers append a single 'd' (or upper-cased 'D') directly to
  // the symbol before '_EQ': IFXd_EQ / IFXD_EQ → IFX.DE, 22UAd_EQ → 22UA.DE.
  // Accept either case because some internal flows upper-case stored tickers.
  // Bare Yahoo-style symbols (SAP.DE) are passed through unchanged.
  t212TickerSuffixes: ['d_EQ', 'D_EQ'],
  toYahooSymbol(t212Ticker: string): string {
    const m = t212Ticker.match(/^([A-Za-z0-9]+)[dD]_EQ$/)
    if (m) return `${m[1]}.DE`
    if (/\.DE$/i.test(t212Ticker)) return t212Ticker
    return t212Ticker
  },
}

export const MARKETS: Record<string, MarketSpec> = {
  NYSE,
  XETRA,
}

/** All known market codes. */
export const MARKET_CODES = Object.keys(MARKETS)

/** Resolve a market spec by code; throws if unknown. */
export function getMarketSpec(code: string): MarketSpec {
  const spec = MARKETS[code]
  if (!spec) throw new Error(`Unknown market code: ${code}`)
  return spec
}

/** Resolve the market spec for a T212 ticker by suffix matching. */
export function inferMarketFromTicker(t212Ticker: string): MarketSpec | null {
  for (const spec of Object.values(MARKETS)) {
    if (spec.t212TickerSuffixes.some((s) => t212Ticker.endsWith(s))) return spec
  }
  return null
}
