import React, { useState, useEffect, useRef } from 'react';
import { 
  Lightning,
  ChartLine,
  ChartScatter,
  Notification,
  ArrowUp,
  ArrowDown,
  Currency,
  ChartBar,
  Play,
  Stop,
  Pause,
  Security
} from '@carbon/icons-react';
import { FeatureCard } from '../components/common/CommonComponents';
import { 
  ProfitMetricCard, 
  LossMetricCard, 
  TradeMetricCard, 
  PerformanceMetricCard 
} from '../components/common/CommonComponents';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import { 
  startLiveTrading, 
  stopLiveTrading, 
  pauseLiveTrading, 
  resumeLiveTrading,
  getLiveTradingStatus,
  getLivePositions,
  getLiveTradingMetrics,
  getRiskLevel,
  getMarketStatus
} from '../services/api';
import PositionManagement from '../components/PositionManagement/PositionManagement';
import '../components/common/CommonComponents.css';
import './LiveTradingPage.css';

// Add a simple error boundary for debugging
class DebugErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: 16 }}>
          <h2>Something went wrong in LiveTradingPage.</h2>
          <pre>{this.state.error && this.state.error.toString()}</pre>
          <pre>{this.state.errorInfo && this.state.errorInfo.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const LiveTradingPage = () => {
  const [liveStatus, setLiveStatus] = useState(null);
  const [positions, setPositions] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [isStopping, setIsStopping] = useState(false);
  const [riskPerTrade, setRiskPerTrade] = useState(10); // Default to $10 per trade
  
  // Live feed states
  const [currentQuote, setCurrentQuote] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const prevPrices = useRef({});
  const wsRef = useRef(null);

  // WebSocket URL for live feed
  const WS_URL =
    window.location.protocol === "https:"
      ? `wss://${window.location.host}/live-trading/ws/live-feed`
      : `ws://${window.location.hostname}:8000/live-trading/ws/live-feed`;

  // Helper functions for live feed
  const getPriceDirection = (prev, curr) => {
    if (prev == null || curr == null) return null;
    if (curr > prev) return "up";
    if (curr < prev) return "down";
    return "same";
  };

  const formatPrice = (price) => {
    if (price == null) return "-";
    return Number(price).toFixed(2);
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "-";
    try {
      return new Date(timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
    } catch {
      return "-";
    }
  };

  // Debug: Log all major state changes
  useEffect(() => {
    console.debug('LiveTradingPage: liveStatus changed', liveStatus);
  }, [liveStatus]);
  useEffect(() => {
    console.debug('LiveTradingPage: positions changed', positions);
  }, [positions]);
  useEffect(() => {
    console.debug('LiveTradingPage: metrics changed', metrics);
  }, [metrics]);
  useEffect(() => {
    console.debug('LiveTradingPage: risk changed', risk);
  }, [risk]);
  useEffect(() => {
    console.debug('LiveTradingPage: error changed', error);
  }, [error]);

  useEffect(() => {
    if (!liveStatus || liveStatus.status !== 'running') {
      setCurrentQuote(null);
      setError(null);
      setIsConnected(false);
      setLastUpdateTime(null);
      console.debug('WebSocket: Not running, skipping connection');
      return;
    }

    console.debug('WebSocket: Connecting to', WS_URL);
    wsRef.current = new window.WebSocket(WS_URL);
    
    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      setError(null);
      setIsConnected(true);
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.debug('WebSocket message:', msg);
        if (msg.type === "quote" && msg.data) {
          setCurrentQuote(msg.data);
          setLastUpdateTime(Date.now());
          setIsConnected(true);
        } else if (msg.type === "error" && msg.message) {
          setError(msg.message);
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
      setIsConnected(false);
    };
    
    wsRef.current.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setIsConnected(false);
      if (event.code !== 1000) {
        setError('WebSocket connection lost');
      }
    };

    return () => {
      if (wsRef.current) {
        console.debug('WebSocket: Closing connection on unmount');
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, [liveStatus?.status]);

  // Check if we're receiving live data (received update in last 10 seconds)
  const isReceivingLiveFeed = isConnected && lastUpdateTime && (Date.now() - lastUpdateTime) < 10000;

  // Process current quote
  const processedQuote = currentQuote ? (() => {
    const symbol = currentQuote.symbol || currentQuote.S || "?";
    const bidPrice = currentQuote.bp || currentQuote.bid_price || null;
    const askPrice = currentQuote.ap || currentQuote.ask_price || null;
    
    // Use mid-price for direction calculation
    const midPrice = bidPrice && askPrice ? (bidPrice + askPrice) / 2 : null;
    const prev = prevPrices.current[symbol];
    const direction = getPriceDirection(prev, midPrice);
    prevPrices.current[symbol] = midPrice;

    return {
      symbol,
      bidPrice,
      askPrice,
      direction,
      timestamp: currentQuote.timestamp || currentQuote.t
    };
  })() : null;

  // Fetch live trading data
  const fetchLiveData = async () => {
    try {
      setError(null);
      const [statusData, positionsData, metricsData, riskData, marketStatusData] = await Promise.all([
        getLiveTradingStatus(),
        getLivePositions(),
        getLiveTradingMetrics(),
        getRiskLevel(),
        getMarketStatus()
      ]);
      setLiveStatus(statusData);
      setPositions(positionsData);
      setMetrics(metricsData);
      setRisk(riskData);
      setMarketStatus(marketStatusData);
    } catch (err) {
      setError('Live trading API not available.');
    }
  };

  // Control functions
  const handleStart = async () => {
    setLoading(true);
    try {
      await startLiveTrading(riskPerTrade);
      await fetchLiveData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setIsStopping(true);
    try {
      // First attempt
      let response = await stopLiveTrading();
      
      // If there's a warning, try one more time after a short delay
      if (response.warning) {
        setError('Stopping system... (this may take a moment)');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        // Second attempt
        response = await stopLiveTrading();
      }
      
      // Check final result
      if (response.warning) {
        setError(`System stopped with warnings: ${response.message}`);
      } else {
        setError(null);
      }
      
      await fetchLiveData();
    } catch (err) {
      // Handle different types of errors more gracefully
      if (err.message.includes('timeout') || err.message.includes('network')) {
        setError('Connection timeout - system may still be stopping. Please refresh the page in a few seconds.');
      } else if (err.message.includes('500')) {
        setError('System stop completed with some issues. Please refresh to confirm status.');
      } else {
        setError(`Stop failed: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setIsStopping(false);
    }
  };

  const handlePause = async () => {
    setLoading(true);
    try {
      await pauseLiveTrading();
      await fetchLiveData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await resumeLiveTrading();
      await fetchLiveData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh data only when live trading is running
  useEffect(() => {
    fetchLiveData();
    
    // Only set up polling if live trading is running
    if (liveStatus?.status === 'running') {
      const interval = setInterval(fetchLiveData, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [liveStatus?.status]); // Re-run effect when status changes

  // Compute current status, but force offline if error
  const currentStatus = error
    ? 'offline'
    : liveStatus?.status || 'stopped';
  const activeStrategies = liveStatus?.active_strategies || [];

  const features = [
    { 
      icon: <ChartLine size={24} />, 
      title: 'Real-time P&L', 
      description: 'Live profit and loss tracking with instant updates' 
    },
    { 
      icon: <ChartScatter size={24} />, 
      title: 'Active Positions', 
      description: 'Monitor open positions and pending orders' 
    },
    { 
      icon: <ArrowUp size={24} />, 
      title: 'Market Data', 
      description: 'Live price feeds and interactive charts' 
    },
    { 
      icon: <Notification size={24} />, 
      title: 'Smart Alerts', 
      description: 'Real-time notifications and risk alerts' 
    }
  ];

  // Helper for safe metric display
  const safeMetric = (val, digits = 2) =>
    typeof val === 'number' && !isNaN(val) ? val.toFixed(digits) : 'N/A';

  // Status indicator color class
  const statusClass =
    currentStatus === 'running'
      ? 'status-indicator--success'
      : currentStatus === 'paused'
      ? 'status-indicator--warning'
      : 'status-indicator--error';

  // Risk color class
  const riskColorClass =
    risk?.risk_level === 'low'
      ? 'risk-indicator--success'
      : risk?.risk_level === 'medium'
      ? 'risk-indicator--warning'
      : risk?.risk_level === 'high'
      ? 'risk-indicator--error'
      : 'risk-indicator--neutral';

  const riskTextClass =
    risk?.risk_level === 'low'
      ? 'risk-text--success'
      : risk?.risk_level === 'medium'
      ? 'risk-text--warning'
      : risk?.risk_level === 'high'
      ? 'risk-text--error'
      : 'risk-text--neutral';

  return (
    <DebugErrorBoundary>
      {/* Page Header Row: header and Start Trading box side by side */}
      <div className="page-header-row">
        <div className="page-header">
          <div className="header-content">
            <div className="header-left">
              <h1 className="page-title">Live Trading Dashboard</h1>
              {/* Status Information Row now directly under the title */}
              <div className="status-row">
                <div className={`status-item status-item--system${currentStatus === 'running' ? ' status-item--success' : ''} ${statusClass}`}>
                  <span className="status-dot"></span>
                  <span className="status-label">System:</span>
                  <span className="status-value">
                    {currentStatus === 'running' ? 'Online' : currentStatus === 'paused' ? 'Paused' : 'Offline'}
                  </span>
                </div>

                {liveStatus?.last_update && (
                  <div className="status-item status-item--update">
                    <span className="status-dot"></span>
                    <span className="status-label">Last Update:</span>
                    <span className="status-value">
                      {new Date(new Date(liveStatus.last_update).getTime() + 60 * 60 * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/Dublin' })}
                    </span>
                  </div>
                )}

                {marketStatus && (
                  <div className={`status-item status-item--markets${marketStatus.is_open ? ' status-item--success' : ''}`}> 
                    <span className="status-dot"></span>
                    <span className="status-label">US Markets:</span>
                    <span className="status-value">
                      {marketStatus.is_open ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                )}

                {marketStatus && (
                  <div className="status-item status-item--time">
                    <span className="status-dot"></span>
                    <span className="status-label">
                      {marketStatus.is_open ? 'Closes in:' : 'Opens in:'}
                    </span>
                    <span className="status-value">
                      {marketStatus.is_open && marketStatus.time_until_close && (
                        `${marketStatus.time_until_close.hours}h ${marketStatus.time_until_close.minutes}m`
                      )}
                      {!marketStatus.is_open && marketStatus.time_until_open && (
                        `${marketStatus.time_until_open.days > 0 ? `${marketStatus.time_until_open.days}d ` : ''}${marketStatus.time_until_open.hours}h ${marketStatus.time_until_open.minutes}m`
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Start Trading Box - in line with header */}
        <div className="header-right">
          <div className="start-trading-box">
            <div className="control-buttons">
              {currentStatus === 'stopped' && (
                <div className="control-buttons-container">
                  <button onClick={handleStart} disabled={loading} className="btn btn-primary">
                    Connect to market...
                  </button>
                  <div className="risk-per-trade-group status-item status-item--right">
                    <label htmlFor="risk-per-trade-input" className="risk-per-trade-label">
                      Invest per trade:
                    </label>
                    <div className="risk-per-trade-input-wrapper">
                      <span className="risk-per-trade-prefix">$</span>
                      <input
                        id="risk-per-trade-input"
                        type="number"
                        min="1"
                        step="1"
                        value={riskPerTrade}
                        onChange={e => setRiskPerTrade(Number(e.target.value))}
                        className="risk-per-trade-input"
                        placeholder="Amount"
                        title="USD budget per trade"
                      />
                    </div>
                  </div>
                </div>
              )}
              {currentStatus === 'running' && (
                <>
                  <button onClick={handlePause} disabled={loading} className="btn btn-secondary">
                    <Pause size={16} />
                    Pause
                  </button>
                  <button onClick={handleStop} disabled={loading || isStopping} className="btn btn-danger">
                    <Stop size={16} />
                    {isStopping ? 'Stopping...' : 'Stop'}
                  </button>
                </>
              )}
              {currentStatus === 'paused' && (
                <>
                  <button onClick={handleResume} disabled={loading} className="btn btn-primary">
                    <Play size={16} />
                    Resume
                  </button>
                  <button onClick={handleStop} disabled={loading} className="btn btn-danger">
                    <Stop size={16} />
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <div className="error-banner__dot"></div>
          <span className="error-banner__text">{error}</span>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="section-header">
        <h2 className="section-title">Performance Overview</h2>
        <p className="section-description">
          Real-time performance metrics and trading statistics
        </p>
      </div>

      <div className="content-grid content-grid-4">
        {/* Total P&L Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Total P&L</h3>
            <ArrowUp size={16} className="metric-card__icon metric-card__icon--trend" />
          </div>
          <div className="metric-card__values">
            <span className={`metric-card__value ${metrics?.performance?.total_pnl >= 0 ? 'metric-card__value--success' : 'metric-card__value--error'}`}>
              {metrics ? formatCurrency(metrics.performance?.total_pnl) : 'N/A'}
            </span>
            <span className={`metric-card__trend ${metrics?.performance?.total_pnl >= 0 ? 'metric-card__trend--success' : 'metric-card__trend--error'}`}>
              {metrics ? (metrics.performance?.total_pnl >= 0 ? '+' : '') + formatPercentage((metrics.performance?.total_pnl / (metrics.positions?.total_market_value || 1)) * 100) : 'N/A'}
            </span>
          </div>
        </div>
        {/* Daily P&L Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Daily P&L</h3>
            <ArrowUp size={16} className="metric-card__icon metric-card__icon--trend" />
          </div>
          <div className="metric-card__values">
            <span className={`metric-card__value ${metrics?.performance?.daily_pnl >= 0 ? 'metric-card__value--success' : 'metric-card__value--error'}`}>
              {metrics ? formatCurrency(metrics.performance?.daily_pnl) : 'N/A'}
            </span>
            <span className={`metric-card__trend ${metrics?.performance?.daily_pnl >= 0 ? 'metric-card__trend--success' : 'metric-card__trend--error'}`}>
              {metrics ? (metrics.performance?.daily_pnl >= 0 ? '+' : '') + formatPercentage((metrics.performance?.daily_pnl / (metrics.positions?.total_market_value || 1)) * 100) : 'N/A'}
            </span>
          </div>
        </div>
        {/* Total Trades Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Total Trades</h3>
            <ChartBar size={16} className="metric-card__icon metric-card__icon--primary" />
          </div>
          <div className="metric-card__values">
            <span className="metric-card__value metric-card__value--neutral">
              {metrics ? metrics.performance?.total_trades?.toString() : 'N/A'}
            </span>
            <span className="metric-card__trend metric-card__trend--neutral">
              {metrics ? '+' + (metrics.performance?.total_trades || 0) : 'N/A'}
            </span>
          </div>
        </div>
        {/* Win Rate Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Win Rate</h3>
            <ArrowUp size={16} className="metric-card__icon metric-card__icon--trend" />
          </div>
          <div className="metric-card__values">
            <span className="metric-card__value metric-card__value--neutral">
              {metrics ? formatPercentage(metrics.performance?.win_rate) : 'N/A'}
            </span>
            <span className="metric-card__trend metric-card__trend--neutral">
              {metrics ? '+' + formatPercentage(metrics.performance?.win_rate) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Daily Performance */}
      <div className="section-header">
        <h2 className="section-title">Daily Performance</h2>
        <p className="section-description">
          Today's trading performance and position summary
        </p>
      </div>

      <div className="content-grid content-grid-4">
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Daily P&L</h3>
            <ArrowUp size={16} className="metric-card__icon metric-card__icon--trend" />
          </div>
          <div className="metric-card__values">
            <span className={`metric-card__value ${metrics?.performance?.daily_pnl >= 0 ? 'metric-card__value--success' : 'metric-card__value--error'}`}>
              {metrics ? formatCurrency(metrics.performance?.daily_pnl) : 'N/A'}
            </span>
            <span className={`metric-card__trend ${metrics?.performance?.daily_pnl >= 0 ? 'metric-card__trend--success' : 'metric-card__trend--error'}`}>
              {metrics ? (metrics.performance?.daily_pnl >= 0 ? '+' : '') + formatPercentage((metrics.performance?.daily_pnl / (metrics.positions?.total_market_value || 1)) * 100) : 'N/A'}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Active Positions</h3>
            <ChartScatter size={16} className="metric-card__icon metric-card__icon--primary" />
          </div>
          <div className="metric-card__values">
            <span className="metric-card__value metric-card__value--neutral">
              {metrics ? metrics.positions?.total_positions : 'N/A'}
            </span>
            <span className="metric-card__trend metric-card__trend--neutral">
              positions
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Risk Level</h3>
            <Security size={16} className="metric-card__icon metric-card__icon--primary" />
          </div>
          <div className="metric-card__values">
            <span className={`metric-card__value ${riskTextClass}`}>
              {risk ? (risk.risk_level?.charAt(0).toUpperCase() + risk.risk_level?.slice(1)) : 'N/A'}
            </span>
            <span className="metric-card__trend metric-card__trend--neutral">
              Risk
            </span>
          </div>
        </div>

        {/* Live Feed Box as a metric card with title */}
        <div className="metric-card metric-card--live-feed">
          {/* Status indicator dot */}
          <div className={`status-dot ${isReceivingLiveFeed ? 'status-dot-green' : 'status-dot-red'}`}></div>
          
          <div className="metric-card__header">
            <h3 className="metric-card__caption">Live Feed</h3>
          </div>
          <div className="live-feed-compact">
            {error ? (
              <div className="live-feed-error-compact">
                <span className="error-icon">⚠️</span>
                {error}
              </div>
            ) : (
              <div className="live-feed-content-compact">
                {!processedQuote ? (
                  <div className="live-feed-empty-compact">
                    <span className="empty-text">
                      {liveStatus?.status === 'running' ? "Waiting..." : "No connection"}
                    </span>
                  </div>
                ) : (
                  <div className="live-feed-quote-compact quote-animate">
                    <div className="quote-header">
                      <span className="quote-symbol-compact">{processedQuote.symbol}</span>
                      <span className="quote-time-compact">{formatTime(processedQuote.timestamp)}</span>
                    </div>
                    <div className="quote-prices">
                      <span className={`quote-price-compact price-${processedQuote.direction || "same"}`}>
                        {processedQuote.direction === "up" && <span className="arrow-compact">▲</span>}
                        {processedQuote.direction === "down" && <span className="arrow-compact">▼</span>}
                        <span className="bid-price">{formatPrice(processedQuote.bidPrice)}</span>
                        <span className="separator">/</span>
                        <span className="ask-price">{formatPrice(processedQuote.askPrice)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Current Positions */}
      <PositionManagement positions={positions} loading={loading} />

    </DebugErrorBoundary>
  );
};

export default LiveTradingPage; 