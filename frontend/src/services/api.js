import axios from "axios";
import { handleApiError, createApiError } from "../utils/errorHandler.js";
import { API_ENDPOINTS } from "../utils/constants.js";

const API_BASE_URL = "/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export const getStrategies = async (status = null) => {
  try {
    const params = status ? { status } : {};
    const response = await api.get(API_ENDPOINTS.STRATEGIES.BASE, { params });
    return response.data;
  } catch (error) {
    console.warn("API not available, using demo strategies");
    return [];
  }
};

export const getStrategy = async (strategyId) => {
  try {
    const response = await api.get(
      `${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`,
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to fetch strategy"));
  }
};

export const createStrategy = async (strategyData) => {
  try {
    const response = await api.post(
      API_ENDPOINTS.STRATEGIES.BASE,
      strategyData,
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to create strategy"));
  }
};

export const updateStrategy = async (strategyId, strategyData) => {
  try {
    const response = await api.put(
      `${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`,
      strategyData,
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to update strategy"));
  }
};

export const deleteStrategy = async (strategyId) => {
  try {
    const response = await api.delete(
      `${API_ENDPOINTS.STRATEGIES.BASE}${strategyId}`,
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to delete strategy"));
  }
};

export const publishStrategy = async (strategyId) => {
  try {
    const response = await api.post(
      API_ENDPOINTS.STRATEGIES.PUBLISH(strategyId),
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to publish strategy"));
  }
};

export const unpublishStrategy = async (strategyId) => {
  try {
    const response = await api.post(
      API_ENDPOINTS.STRATEGIES.UNPUBLISH(strategyId),
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to unpublish strategy"));
  }
};

export const runStrategyBacktest = async (strategyId, backtestParams) => {
  try {
    const response = await api.post(
      API_ENDPOINTS.STRATEGIES.BACKTEST(strategyId),
      backtestParams,
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to run backtest"));
  }
};

export const getBacktestHistory = async (strategyId) => {
  try {
    const response = await api.get(
      API_ENDPOINTS.STRATEGIES.BACKTESTS(strategyId),
    );
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to get backtest history"),
    );
  }
};

export const startLiveTrading = async (riskPerTrade) => {
  try {
    const response = await api.post(
      "/live-trading/start",
      riskPerTrade !== undefined ? { risk_per_trade: riskPerTrade } : {},
    );
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to start live trading"));
  }
};

export const stopLiveTrading = async () => {
  try {
    const response = await api.post("/live-trading/stop");
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to stop live trading"));
  }
};

export const pauseLiveTrading = async () => {
  try {
    const response = await api.post("/live-trading/pause");
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to pause live trading"));
  }
};

export const resumeLiveTrading = async () => {
  try {
    const response = await api.post("/live-trading/resume");
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to resume live trading"),
    );
  }
};

export const getLiveTradingStatus = async () => {
  try {
    const response = await api.get("/live-trading/status");
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to fetch live trading status"),
    );
  }
};

export const getLivePositions = async () => {
  try {
    const response = await api.get("/live-trading/positions");
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to fetch live positions"),
    );
  }
};

export const getLiveTradingMetrics = async () => {
  try {
    const response = await api.get("/live-trading/metrics");
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to fetch live trading metrics"),
    );
  }
};

export const getRiskLevel = async () => {
  try {
    const response = await api.get("/live-trading/risk");
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to fetch risk level"));
  }
};

export const getMarketStatus = async () => {
  try {
    const response = await api.get("/market/market-status");
    return response.data;
  } catch (error) {
    throw createApiError(
      handleApiError(error, "Failed to fetch market status"),
    );
  }
};

export const getMarketHours = async () => {
  try {
    const response = await api.get("/market/market-hours");
    return response.data;
  } catch (error) {
    throw createApiError(handleApiError(error, "Failed to fetch market hours"));
  }
};

export { api };
