import axios from 'axios'
import { handleApiError, createApiError } from '../utils/errorHandler.js'
import { API_ENDPOINTS } from '../utils/constants.js'

const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const analyzePerformance = async (initialCapital) => {
  try {
    const response = await api.post(API_ENDPOINTS.ANALYSIS, {
      initial_capital: initialCapital
    })
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to analyze performance'))
  }
}

export const getSignals = async () => {
  try {
    const response = await api.get(API_ENDPOINTS.SIGNALS)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch signals'))
  }
}

export const getTrades = async () => {
  try {
    const response = await api.get(API_ENDPOINTS.TRADES)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch trades'))
  }
}



export const pauseTrading = async () => {
  try {
    const response = await api.post(API_ENDPOINTS.EMERGENCY.PAUSE)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to pause trading'))
  }
}

export const resumeTrading = async () => {
  try {
    const response = await api.post(API_ENDPOINTS.EMERGENCY.RESUME)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to resume trading'))
  }
}

export const dumpPositions = async () => {
  try {
    const response = await api.post(API_ENDPOINTS.EMERGENCY.DUMP_POSITIONS)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to dump positions'))
  }
}

export const getTradingStatus = async () => {
  try {
    const response = await api.get('/emergency/status')
    return response.data.paused
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch trading status'))
  }
}

export const getStrategies = async (status = null) => {
  try {
    const params = status ? { status } : {}
    const response = await api.get(API_ENDPOINTS.STRATEGIES.BASE, { params })
    return response.data
  } catch (error) {
    console.warn('API not available, using demo strategies')
    return []
  }
}

export const getStrategy = async (strategyId) => {
  try {
    const response = await api.get(`${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch strategy'))
  }
}

export const createStrategy = async (strategyData) => {
  try {
    const response = await api.post(API_ENDPOINTS.STRATEGIES.BASE, strategyData)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to create strategy'))
  }
}

export const updateStrategy = async (strategyId, strategyData) => {
  try {
    const response = await api.put(`${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`, strategyData)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to update strategy'))
  }
}

export const deleteStrategy = async (strategyId) => {
  try {
    const response = await api.delete(`${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to delete strategy'))
  }
}

export const publishStrategy = async (strategyId) => {
  try {
    const response = await api.post(API_ENDPOINTS.STRATEGIES.PUBLISH(strategyId))
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to publish strategy'))
  }
}

export const unpublishStrategy = async (strategyId) => {
  try {
    const response = await api.post(API_ENDPOINTS.STRATEGIES.UNPUBLISH(strategyId))
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to unpublish strategy'))
  }
}

export const runStrategyBacktest = async (strategyId, backtestParams) => {
  try {
    const response = await api.post(API_ENDPOINTS.STRATEGIES.BACKTEST(strategyId), backtestParams)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to run backtest'))
  }
}

export const getBacktestHistory = async (strategyId) => {
  try {
    const response = await api.get(API_ENDPOINTS.STRATEGIES.BACKTESTS(strategyId))
    return response.data
  } catch (error) {
    // Fallback to demo data if API is not available
    console.warn('API not available, using demo backtest history')
    return [
      {
        id: '1',
        strategy_name: 'AAPL-MSFT Pair Trading',
        timestamp: '2024-01-20T14:30:00Z',
        initial_capital: 100000,
        test_duration_days: 30,
        total_profit: 15420.50,
        return_pct: 0.1542,
        sharpe_ratio: 1.85,
        max_drawdown: 0.0823,
        win_rate: 0.634,
        total_trades: 247,
        equity_curve: [
          { date: '2024-01-01', value: 100000 },
          { date: '2024-01-15', value: 102340 },
          { date: '2024-02-01', value: 104560 },
          { date: '2024-02-15', value: 101890 },
          { date: '2024-03-01', value: 107230 },
          { date: '2024-03-15', value: 109450 },
          { date: '2024-04-01', value: 112780 },
          { date: '2024-04-15', value: 115420 }
        ],
        trades: [
          { date: '2024-01-15', symbol: 'AAPL', side: 'buy', quantity: 100, price: 185.50, pnl: 1250.00 },
          { date: '2024-01-20', symbol: 'MSFT', side: 'sell', quantity: 50, price: 420.75, pnl: -450.00 }
        ]
      }
    ]
  }
}

export const getStrategyYaml = async (strategyId) => {
  try {
    const response = await api.get(API_ENDPOINTS.STRATEGIES.YAML(strategyId))
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch YAML configuration'))
  }
}

export const updateStrategyYaml = async (strategyId, yamlContent) => {
  try {
    const response = await api.post(API_ENDPOINTS.STRATEGIES.YAML(strategyId), yamlContent)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to update YAML configuration'))
  }
}

// Live Trading API functions
export const startLiveTrading = async () => {
  try {
    const response = await api.post('/live-trading/start')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to start live trading'))
  }
}

export const stopLiveTrading = async () => {
  try {
    const response = await api.post('/live-trading/stop')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to stop live trading'))
  }
}

export const pauseLiveTrading = async () => {
  try {
    const response = await api.post('/live-trading/pause')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to pause live trading'))
  }
}

export const resumeLiveTrading = async () => {
  try {
    const response = await api.post('/live-trading/resume')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to resume live trading'))
  }
}

export const getLiveTradingStatus = async () => {
  try {
    const response = await api.get('/live-trading/status')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch live trading status'))
  }
}

export const getLivePositions = async () => {
  try {
    const response = await api.get('/live-trading/positions')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch live positions'))
  }
}

export const getAvailableStrategies = async () => {
  try {
    const response = await api.get('/live-trading/strategies')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch available strategies'))
  }
}

export const enableStrategy = async (strategyId) => {
  try {
    const response = await api.post(`/live-trading/strategies/${strategyId}/enable`)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to enable strategy'))
  }
}

export const disableStrategy = async (strategyId) => {
  try {
    const response = await api.post(`/live-trading/strategies/${strategyId}/disable`)
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to disable strategy'))
  }
}

export const getLiveTradingMetrics = async () => {
  try {
    const response = await api.get('/live-trading/metrics')
    return response.data
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch live trading metrics'))
  }
}

export const getRiskLevel = async () => {
  try {
    const response = await api.get('/live-trading/risk');
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch risk level'));
  }
}

export const getMarketStatus = async () => {
  try {
    const response = await api.get('/market/market-status');
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch market status'));
  }
}

export const getMarketHours = async () => {
  try {
    const response = await api.get('/market/market-hours');
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, 'Failed to fetch market hours'));
  }
}

// Export the api instance for direct use if needed
export { api } 