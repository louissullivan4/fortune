import { describe, expect, it } from 'vitest'
import { NYSE, XETRA, inferMarketFromTicker } from './registry.js'

describe('inferMarketFromTicker', () => {
  it('claims US tickers for NYSE', () => {
    expect(inferMarketFromTicker('AAPL_US_EQ')?.code).toBe('NYSE')
    expect(inferMarketFromTicker('NVDA_US_EQ')?.code).toBe('NYSE')
  })

  it('claims T212 Xetra tickers (single-letter d suffix) for XETRA', () => {
    // T212 actually uses <SYMBOL>d_EQ; stored tickers sometimes get upper-cased.
    expect(inferMarketFromTicker('IFXd_EQ')?.code).toBe('XETRA')
    expect(inferMarketFromTicker('IFXD_EQ')?.code).toBe('XETRA')
    expect(inferMarketFromTicker('22UAD_EQ')?.code).toBe('XETRA')
    expect(inferMarketFromTicker('LHAD_EQ')?.code).toBe('XETRA')
  })

  it('returns null for unknown ticker formats', () => {
    expect(inferMarketFromTicker('UNKNOWN')).toBeNull()
    expect(inferMarketFromTicker('IFX.DE')).toBeNull()
  })
})

describe('XETRA.toYahooSymbol', () => {
  // T212 ticker → Yahoo Finance symbol mappings these tests anchor against.
  // The whole Xetra backtest path depends on these resolving to real Yahoo
  // symbols; getting them wrong silently produces empty histories.
  const cases: Array<[string, string]> = [
    ['IFXD_EQ', 'IFX.DE'], // Infineon
    ['IFXd_EQ', 'IFX.DE'], // lower-case variant
    ['LHAD_EQ', 'LHA.DE'], // Lufthansa
    ['NEMD_EQ', 'NEM.DE'], // Nemetschek
    ['HFGD_EQ', 'HFG.DE'], // HelloFresh
    ['TMVD_EQ', 'TMV.DE'], // TeamViewer
    ['EVTD_EQ', 'EVT.DE'], // Evotec
    ['AIXAD_EQ', 'AIXA.DE'], // Aixtron
    ['22UAD_EQ', '22UA.DE'], // Auto1
    ['SAP.DE', 'SAP.DE'], // already in Yahoo format
  ]

  for (const [t212, yahoo] of cases) {
    it(`${t212} → ${yahoo}`, () => {
      expect(XETRA.toYahooSymbol(t212)).toBe(yahoo)
    })
  }
})

describe('NYSE.toYahooSymbol', () => {
  it('strips the _US_EQ suffix', () => {
    expect(NYSE.toYahooSymbol('AAPL_US_EQ')).toBe('AAPL')
    expect(NYSE.toYahooSymbol('NVDA_US_EQ')).toBe('NVDA')
  })
})
