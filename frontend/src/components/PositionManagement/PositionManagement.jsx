import React from 'react';
import { formatCurrency, formatPercentage } from '../../utils/formatters';
import './PositionManagement.css';

const PositionManagement = ({ positions = [], loading = false }) => {
  if (loading) {
    return (
      <div className="position-management">
        <div className="section-header">
          <h2 className="section-title">Current Positions</h2>
          <p className="section-description">
            Real-time position tracking and P&L monitoring
          </p>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-3 text-neutral">Loading positions...</span>
          </div>
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="position-management">
        <div className="section-header">
          <h2 className="section-title">Current Positions</h2>
          <p className="section-description">
            Real-time position tracking and P&L monitoring
          </p>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="text-neutral text-lg mb-2">No active positions</div>
              <div className="text-sm text-neutral-light">
                Positions will appear here when strategies generate entry signals
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate summary metrics
  const totalUnrealizedPnl = positions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0);
  const totalMarketValue = positions.reduce((sum, pos) => sum + pos.market_value, 0);
  const profitablePositions = positions.filter(pos => pos.unrealized_pnl > 0).length;
  const winRate = positions.length > 0 ? (profitablePositions / positions.length) * 100 : 0;

  return (
    <div className="position-management">
      <div className="section-header">
        <h2 className="section-title">Current Positions</h2>
        <p className="section-description">
          Real-time position tracking and P&L monitoring
        </p>
      </div>

      {/* Position Summary */}
      <div className="content-grid content-grid-4 mb-6">
        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Total Positions
            </h3>
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-gray-900">
              {positions.length}
            </span>
            <span className="ml-2 body-small font-medium text-neutral">
              positions
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Total Market Value
            </h3>
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-gray-900">
              {formatCurrency(totalMarketValue)}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Unrealized P&L
            </h3>
          </div>
          <div className="flex items-baseline">
            <span className={`display-small font-semibold ${totalUnrealizedPnl >= 0 ? 'text-success' : 'text-error'}`}>
              {formatCurrency(totalUnrealizedPnl)}
            </span>
            <span className={`ml-2 body-small font-medium ${totalUnrealizedPnl >= 0 ? 'text-success' : 'text-error'}`}>
              {totalUnrealizedPnl >= 0 ? '+' : ''}{formatPercentage(totalUnrealizedPnl / totalMarketValue * 100)}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="caption text-neutral font-medium uppercase tracking-wide">
              Win Rate
            </h3>
          </div>
          <div className="flex items-baseline">
            <span className="display-small font-semibold text-gray-900">
              {formatPercentage(winRate)}
            </span>
            <span className="ml-2 body-small font-medium text-neutral">
              ({profitablePositions}/{positions.length})
            </span>
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="metric-card">
        <div className="overflow-x-auto">
          <table className="w-full positions-table">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-neutral">Symbol</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Quantity</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Entry Price</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Current Price</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Market Value</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Unrealized P&L</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">P&L %</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Strategy</th>
                <th className="text-left py-3 px-4 font-medium text-neutral">Entry Time</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => (
                <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium">{position.symbol}</td>
                  <td className="py-3 px-4">
                    <span className={position.quantity > 0 ? 'text-success' : 'text-error'}>
                      {position.quantity > 0 ? '+' : ''}{position.quantity}
                    </span>
                  </td>
                  <td className="py-3 px-4">{formatCurrency(position.entry_price)}</td>
                  <td className="py-3 px-4">{formatCurrency(position.current_price)}</td>
                  <td className="py-3 px-4">{formatCurrency(position.market_value)}</td>
                  <td className={`py-3 px-4 font-medium ${position.unrealized_pnl >= 0 ? 'text-success' : 'text-error'}`}>
                    {formatCurrency(position.unrealized_pnl)}
                  </td>
                  <td className={`py-3 px-4 font-medium ${position.pnl_percentage >= 0 ? 'text-success' : 'text-error'}`}>
                    {position.pnl_percentage >= 0 ? '+' : ''}{formatPercentage(position.pnl_percentage)}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <span className="inline-block px-2 py-1 bg-primary-bg text-primary rounded text-xs">
                      {position.strategy_name}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-neutral-light">
                    {new Date(position.entry_time).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PositionManagement; 