import type { PortfolioSnapshot } from '../api/trading212.js'
import type { Trading212Client } from '../api/trading212.js'
import type { UserConfig } from '../types/user.js'
import { resolveFxRates } from '../api/fx.js'

export interface OrderRequest {
  action: 'buy' | 'sell'
  ticker: string
  quantity: number
  /**
   * Price per share in the instrument's trading currency (matches T212's
   * averagePrice / currentPrice). Risk manager converts to EUR internally
   * using T212 position fxRate or a live FX lookup.
   */
  estimatedPrice: number
}

export interface RiskDecision {
  allowed: boolean
  reason?: string
}

export async function validateOrder(
  order: OrderRequest,
  snapshot: PortfolioSnapshot,
  dailyOpenValue: number,
  t212: Trading212Client,
  userConfig: UserConfig
): Promise<RiskDecision> {
  const { maxBudgetEur, maxPositionPct, dailyLossLimitPct } = userConfig

  // Daily loss halt
  const drawdown = (dailyOpenValue - snapshot.totalValue) / dailyOpenValue
  if (drawdown > dailyLossLimitPct) {
    return {
      allowed: false,
      reason: `Daily loss limit hit: portfolio is down ${(drawdown * 100).toFixed(1)}% from day open (limit: ${(dailyLossLimitPct * 100).toFixed(0)}%)`,
    }
  }

  // Instrument minimum quantity check
  const instruments = await t212.getInstruments()
  const instrument = instruments.get(order.ticker)
  if (instrument && order.quantity < instrument.minTradeQuantity) {
    return {
      allowed: false,
      reason: `Quantity ${order.quantity} is below minimum trade quantity of ${instrument.minTradeQuantity} for ${order.ticker}`,
    }
  }

  if (order.action === 'buy') {
    const existingPosition = snapshot.positions.find((p) => p.ticker === order.ticker)
    if (existingPosition) {
      return {
        allowed: false,
        reason: `Already holding a position in ${order.ticker} — will not add to existing position`,
      }
    }

    // Convert order cost from the instrument's native currency to EUR so
    // budget/position-size checks compare apples to apples. We need FX for the
    // new ticker — sample a same-currency live position when possible (cheap,
    // already derived), otherwise fall back to resolveFxRates.
    const currencyCode = instrument?.currencyCode ?? 'EUR'
    const samePositionFx = snapshot.positions.find(
      (p) => p.currencyCode === currencyCode && Number.isFinite(p.fxRate) && p.fxRate > 0
    )?.fxRate
    let fxRate = samePositionFx ?? (currencyCode === 'EUR' ? 1 : null)
    if (fxRate === null) {
      const rates = await resolveFxRates([
        {
          currencyCode,
          currentPrice: order.estimatedPrice,
          averagePrice: order.estimatedPrice,
          quantity: order.quantity,
          ppl: 0,
          fxPpl: null,
        },
      ])
      fxRate = rates.get(currencyCode) ?? 1
    }

    const orderCostEur = order.quantity * order.estimatedPrice * fxRate

    if (orderCostEur > maxBudgetEur) {
      return {
        allowed: false,
        reason: `Order cost €${orderCostEur.toFixed(2)} exceeds hard budget cap of €${maxBudgetEur}`,
      }
    }

    const minBuffer = 5
    if (snapshot.cash.free - orderCostEur < minBuffer) {
      return {
        allowed: false,
        reason: `Insufficient free cash. Available: €${snapshot.cash.free.toFixed(2)}, order cost: €${orderCostEur.toFixed(2)}, min buffer: €${minBuffer}`,
      }
    }

    const maxPositionValue = maxBudgetEur * maxPositionPct
    if (orderCostEur > maxPositionValue) {
      return {
        allowed: false,
        reason: `Position would exceed max size of €${maxPositionValue.toFixed(2)} (${(maxPositionPct * 100).toFixed(0)}% of budget)`,
      }
    }
  }

  if (order.action === 'sell') {
    const position = snapshot.positions.find((p) => p.ticker === order.ticker)
    if (!position) {
      return { allowed: false, reason: `Cannot sell ${order.ticker} — no position held` }
    }
    if (order.quantity > position.quantity) {
      return {
        allowed: false,
        reason: `Cannot sell ${order.quantity} of ${order.ticker} — only holding ${position.quantity}`,
      }
    }
  }

  return { allowed: true }
}

export function computeBuyQuantity(
  ticker: string,
  estimatedPrice: number,
  snapshot: PortfolioSnapshot,
  userConfig: UserConfig,
  minTradeQuantity = 0.01,
  targetFraction = 0.5,
  fxRate = 1
): number {
  const maxPositionValue = userConfig.maxBudgetEur * userConfig.maxPositionPct
  const existingPosition = snapshot.positions.find((p) => p.ticker === ticker)
  const currentPositionValueEur = existingPosition ? existingPosition.costBasisEur : 0
  const remainingPositionRoomEur = maxPositionValue - currentPositionValueEur

  const targetSpendEur = Math.min(
    userConfig.maxBudgetEur * targetFraction,
    snapshot.cash.free - 5,
    remainingPositionRoomEur
  )
  if (targetSpendEur <= 0 || estimatedPrice <= 0 || fxRate <= 0) return 0
  const targetSpendNative = targetSpendEur / fxRate
  const qty = Math.floor((targetSpendNative / estimatedPrice) * 100) / 100
  return qty >= minTradeQuantity ? qty : 0
}
