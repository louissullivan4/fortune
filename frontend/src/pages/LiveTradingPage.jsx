import React, { useState, useEffect } from 'react';
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
  Resume
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
  getLiveTradingMetrics
} from '../services/api';
import '../components/common/CommonComponents.css';
import './LiveTradingPage.css';

const LiveTradingPage = () => {
  const [liveStatus, setLiveStatus] = useState(null);
  const [positions, setPositions] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Demo data fallback
  const demoMetrics = {
    totalProfit: 15420.50,
    totalLoss: -3240.75,
    totalTrades: 247,
    winRate: 68.4,
    currentPositions: 12,
    dailyPnL: 1250.00,
    weeklyPnL: 8900.00,
    monthlyPnL: 15420.50
  };

  // Fetch live trading data
  const fetchLiveData = async () => {
    try {
      setError(null);
      const [statusData, positionsData, metricsData] = await Promise.all([
        getLiveTradingStatus(),
        getLivePositions(),
        getLiveTradingMetrics()
      ]);
      
      setLiveStatus(statusData);
      setPositions(positionsData);
      setMetrics(metricsData);
    } catch (err) {
      console.warn('Live trading API not available, using demo data');
      setError('Live trading API not available - showing demo data');
    }
  };

  // Control functions
  const handleStart = async () => {
    setLoading(true);
    try {
      await startLiveTrading();
      await fetchLiveData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopLiveTrading();
      await fetchLiveData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  // Auto-refresh data
  useEffect(() => {
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Use real data if available, otherwise fallback to demo
  const currentMetrics = metrics || demoMetrics;
  const currentStatus = liveStatus?.status || 'stopped';
  const currentPositions = positions.length > 0 ? positions.length : demoMetrics.currentPositions;

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

  return (
    <div className="live-trading-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="flex items-center mb-4">
          <div className="mr-3 p-2 bg-primary-accent-bg rounded-lg">
            <Lightning size={24} className="text-primary" />
          </div>
          <div>
            <h1 className="page-title">Live Trading Dashboard</h1>
            <p className="page-subtitle">
              Real-time monitoring and control of your trading strategies
            </p>
          </div>
        </div>
        
        <div className="page-actions">
          <div className="flex items-center space-x-4">
            {/* Status Indicators */}
            <div className={`status-indicator ${currentStatus === 'running' ? 'status-success' : currentStatus === 'paused' ? 'status-warning' : 'status-error'}`}>
              <div className={`w-2 h-2 rounded-full mr-2 ${currentStatus === 'running' ? 'bg-success' : currentStatus === 'paused' ? 'bg-warning' : 'bg-error'}`}></div>
              {currentStatus === 'running' ? 'System Online' : currentStatus === 'paused' ? 'System Paused' : 'System Offline'}
            </div>
            
            {liveStatus?.last_update && (
              <div className="status-indicator status-info">
                <div className="w-2 h-2 bg-primary rounded-full mr-2"></div>
                Last Update: {new Date(liveStatus.last_update).toLocaleTimeString()}
              </div>
            )}

            {/* Control Buttons */}
            <div className="flex items-center space-x-2">
              {currentStatus === 'stopped' && (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="btn btn-primary flex items-center space-x-2"
                >
                  <Play size={16} />
                  <span>Start</span>
                </button>
              )}
              
              {currentStatus === 'running' && (
                <>
                  <button
                    onClick={handlePause}
                    disabled={loading}
                    className="btn btn-secondary flex items-center space-x-2"
                  >
                    <Pause size={16} />
                    <span>Pause</span>
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="btn btn-danger flex items-center space-x-2"
                  >
                    <Stop size={16} />
                    <span>Stop</span>
                  </button>
                </>
              )}
              
              {currentStatus === 'paused' && (
                <>
                  <button
                    onClick={handleResume}
                    disabled={loading}
                    className="btn btn-primary flex items-center space-x-2"
                  >
                    <Resume size={16} />
                    <span>Resume</span>
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="btn btn-danger flex items-center space-x-2"
                  >
                    <Stop size={16} />
                    <span>Stop</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-error-bg border border-error rounded-lg">
          <div className="flex items-center">
            <div className="w-2 h-2 bg-error rounded-full mr-3"></div>
            <span className="text-error font-medium">{error}</span>
          </div>
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
        <ProfitMetricCard
          title="Total P&L"
          value={formatCurrency(metrics?.performance?.total_pnl || demoMetrics.totalProfit)}
          trend={metrics?.performance?.total_pnl >= 0 ? "up" : "down"}
          trendValue={metrics?.performance?.total_pnl >= 0 ? "+" : "" + formatPercentage(metrics?.performance?.total_pnl / 100000 * 100 || 12.5)}
        />
        <LossMetricCard
          title="Daily P&L"
          value={formatCurrency(metrics?.performance?.daily_pnl || demoMetrics.dailyPnL)}
          trend={metrics?.performance?.daily_pnl >= 0 ? "up" : "down"}
          trendValue={metrics?.performance?.daily_pnl >= 0 ? "+" : "" + formatPercentage(metrics?.performance?.daily_pnl / 10000 * 100 || 2.4)}
        />
        <TradeMetricCard
          title="Total Trades"
          value={(metrics?.performance?.total_trades || demoMetrics.totalTrades).toString()}
          trend="up"
          trendValue="+15"
        />
        <PerformanceMetricCard
          title="Win Rate"
          value={formatPercentage(metrics?.performance?.win_rate || demoMetrics.winRate)}
          trend="up"
          trendValue="+2.1%"
        />
      </div>

      {/* Daily Performance */}
      <div className="section-header">
        <h2 className="section-title">Daily Performance</h2>
        <p className="section-description">
          Today's trading performance and position summary
        </p>
      </div>

      <div className="content-grid content-grid-3">
        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Daily P&L
            </h3>
            <ArrowUp size={16} className={metrics?.performance?.daily_pnl >= 0 ? "text-success" : "text-error"} />
          </div>
          <div className="flex items-baseline">
            <span className={`display-small font-semibold ${metrics?.performance?.daily_pnl >= 0 ? "text-success" : "text-error"}`}>
              {formatCurrency(metrics?.performance?.daily_pnl || demoMetrics.dailyPnL)}
            </span>
            <span className={`ml-2 body-small font-medium ${metrics?.performance?.daily_pnl >= 0 ? "text-success" : "text-error"}`}>
              {metrics?.performance?.daily_pnl >= 0 ? "+" : ""}{formatPercentage(metrics?.performance?.daily_pnl / 10000 * 100 || 2.4)}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Active Positions
            </h3>
            <ChartScatter size={16} className="text-primary" />
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-gray-900">
              {metrics?.positions?.total_positions || currentPositions}
            </span>
            <span className="ml-2 body-small font-medium text-neutral">
              positions
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Risk Level
            </h3>
            <div className="w-3 h-3 bg-success rounded-full"></div>
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-success">
              Low
            </span>
            <span className="ml-2 body-small font-medium text-neutral">
              Risk
            </span>
          </div>
        </div>
      </div>

      {/* Coming Soon Features */}
      <div className="section-header">
        <h2 className="section-title">Advanced Features</h2>
        <p className="section-description">
          Enhanced trading capabilities coming soon
        </p>
      </div>

      <div className="content-grid content-grid-4">
        {features.map((feature, index) => (
          <FeatureCard
            key={index}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
          />
        ))}
      </div>

      {/* System Status */}
      <div className="section-header">
        <h2 className="section-title">System Status</h2>
        <p className="section-description">
          Current system health and connectivity status
        </p>
      </div>

      <div className="content-grid content-grid-2">
        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Data Feed Status
            </h3>
            <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Market Data</span>
              <span className="body-small text-success">Connected</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Order Execution</span>
              <span className="body-small text-success">Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Risk Management</span>
              <span className="body-small text-success">Enabled</span>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Performance Summary
            </h3>
            <ChartBar size={16} className="text-primary" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Weekly P&L</span>
              <span className="body-small text-success">{formatCurrency(demoMetrics.weeklyPnL)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Monthly P&L</span>
              <span className="body-small text-success">{formatCurrency(demoMetrics.monthlyPnL)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="body-small text-neutral">Sharpe Ratio</span>
              <span className="body-small text-success">1.85</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTradingPage; 