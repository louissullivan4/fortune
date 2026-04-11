import type { PortfolioSnapshot } from '../api/trading212.js'
import type { Trading212Client } from '../api/trading212.js'
import type { UserConfig } from '../types/user.js'

export interface OrderRequest {
  action: 'buy' | 'sell'
  ticker: string
  quantity: number
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
    const orderCost = order.quantity * order.estimatedPrice

    if (orderCost > maxBudgetEur) {
      return {
        allowed: false,
        reason: `Order cost €${orderCost.toFixed(2)} exceeds hard budget cap of €${maxBudgetEur}`,
      }
    }

    const minBuffer = 5
    if (snapshot.cash.free - orderCost < minBuffer) {
      return {
        allowed: false,
        reason: `Insufficient free cash. Available: €${snapshot.cash.free.toFixed(2)}, order cost: €${orderCost.toFixed(2)}, min buffer: €${minBuffer}`,
      }
    }

    const existingPosition = snapshot.positions.find((p) => p.ticker === order.ticker)
    if (existingPosition) {
      return {
        allowed: false,
        reason: `Already holding a position in ${order.ticker} — will not add to existing position`,
      }
    }

    const maxPositionValue = maxBudgetEur * maxPositionPct
    if (orderCost > maxPositionValue) {
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
  targetFraction = 0.5
): number {
  const maxPositionValue = userConfig.maxBudgetEur * userConfig.maxPositionPct
  const existingPosition = snapshot.positions.find((p) => p.ticker === ticker)
  const currentPositionValue = existingPosition
    ? existingPosition.averagePrice * existingPosition.quantity
    : 0
  const remainingPositionRoom = maxPositionValue - currentPositionValue

  const targetSpend = Math.min(
    userConfig.maxBudgetEur * targetFraction,
    snapshot.cash.free - 5,
    remainingPositionRoom
  )
  if (targetSpend <= 0 || estimatedPrice <= 0) return 0
  const qty = Math.floor((targetSpend / estimatedPrice) * 100) / 100
  return qty >= minTradeQuantity ? qty : 0
}
