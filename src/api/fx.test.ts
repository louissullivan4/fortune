import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { deriveFxFromPosition, resolveFxRates, __clearFxCacheForTests } from './fx.js'

beforeEach(() => {
  __clearFxCacheForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deriveFxFromPosition', () => {
  it('solves FX from price-ppl in EUR over price-ppl in native', () => {
    // USD position, EUR/USD ≈ 0.85:
    //   (currentPrice - averagePrice) × qty = (110 - 100) × 10 = 100 USD price PnL
    //   ppl (EUR) = 85, fxPpl = 0 → pricePplEur = 85
    //   fxRate = 85 / 100 = 0.85
    const rate = deriveFxFromPosition({
      currentPrice: 110,
      averagePrice: 100,
      quantity: 10,
      ppl: 85,
      fxPpl: 0,
    })
    expect(rate).toBeCloseTo(0.85, 6)
  })

  it('strips fxPpl from ppl before dividing', () => {
    const rate = deriveFxFromPosition({
      currentPrice: 110,
      averagePrice: 100,
      quantity: 10,
      ppl: 90, // price+fx mixed
      fxPpl: 5,
    })
    // pricePplEur = 90 - 5 = 85; fxRate = 85 / 100 = 0.85
    expect(rate).toBeCloseTo(0.85, 6)
  })

  it('returns null when the position is essentially flat', () => {
    const rate = deriveFxFromPosition({
      currentPrice: 100.001,
      averagePrice: 100,
      quantity: 1,
      ppl: 0,
      fxPpl: 0,
    })
    expect(rate).toBeNull()
  })

  it('treats null fxPpl as zero', () => {
    const rate = deriveFxFromPosition({
      currentPrice: 110,
      averagePrice: 100,
      quantity: 10,
      ppl: 85,
      fxPpl: null,
    })
    expect(rate).toBeCloseTo(0.85, 6)
  })
})

describe('resolveFxRates', () => {
  it('always maps EUR to 1 and derives USD from a movement-ful position', async () => {
    const rates = await resolveFxRates([
      {
        currencyCode: 'USD',
        currentPrice: 110,
        averagePrice: 100,
        quantity: 10,
        ppl: 85,
        fxPpl: 0,
      },
    ])
    expect(rates.get('EUR')).toBe(1)
    expect(rates.get('USD')).toBeCloseTo(0.85, 6)
  })

  it('falls back to the Frankfurter API when no position supplies a derivable rate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rates: { EUR: 0.92 } }),
    } as Response)

    const rates = await resolveFxRates([
      {
        currencyCode: 'USD',
        currentPrice: 100,
        averagePrice: 100, // flat — cannot derive
        quantity: 5,
        ppl: 0,
        fxPpl: 0,
      },
    ])
    expect(rates.get('USD')).toBe(0.92)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/from=USD&to=EUR/)
  })

  it('uses 1.0 as a last resort when derivation and fetch both fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const rates = await resolveFxRates([
      {
        currencyCode: 'USD',
        currentPrice: 100,
        averagePrice: 100,
        quantity: 1,
        ppl: 0,
        fxPpl: 0,
      },
    ])
    expect(rates.get('USD')).toBe(1)
  })
})
