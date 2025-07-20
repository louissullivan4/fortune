import { 
  ProfitMetricCard, 
  LossMetricCard, 
  TradeMetricCard, 
  PerformanceMetricCard 
} from '../common/CommonComponents'
import { formatCurrency, formatPercentage } from '../../utils/formatters'
import '../common/CommonComponents.css'
import './MetricsGrid.css'

const MetricsGrid = ({ data }) => {
  const winRate = data.n_trades > 0 ? (data.winning_trades / data.n_trades) * 100 : 0

  return (
    <div className="metrics-grid">
      <ProfitMetricCard
        title="Total Profit"
        value={formatCurrency(data.total_profit)}
        trend={data.total_profit >= 0 ? "up" : "down"}
        trendValue={data.total_profit >= 0 ? "+" + formatPercentage(data.return_pct) : formatPercentage(data.return_pct)}
      />
      <PerformanceMetricCard
        title="Return %"
        value={formatPercentage(data.return_pct)}
        trend={data.return_pct >= 0 ? "up" : "down"}
        trendValue={data.return_pct >= 0 ? "+" + formatPercentage(data.return_pct) : formatPercentage(data.return_pct)}
      />
      <TradeMetricCard
        title="Total Trades"
        value={data.n_trades.toString()}
        trend="up"
        trendValue="+" + Math.floor(data.n_trades * 0.1).toString()}
      />
      <PerformanceMetricCard
        title="Win Rate"
        value={formatPercentage(winRate)}
        trend={winRate >= 50 ? "up" : "down"}
        trendValue={winRate >= 50 ? "+" + formatPercentage(winRate - 50) : formatPercentage(winRate - 50)}
      />
    </div>
  )
}

export default MetricsGrid 