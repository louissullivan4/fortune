import MetricCard from '../MetricCard/MetricCard'
import { formatCurrency, formatPercentage } from '../../utils/formatters'
import './MetricsGrid.css'

const MetricsGrid = ({ data }) => {
  const winRate = data.n_trades > 0 ? (data.winning_trades / data.n_trades) * 100 : 0

  const metrics = [
    {
      icon: '💰',
      title: 'Total Profit',
      value: formatCurrency(data.total_profit),
      isPositive: data.total_profit >= 0
    },
    {
      icon: '📊',
      title: 'Return %',
      value: formatPercentage(data.return_pct),
      isPositive: data.return_pct >= 0
    },
    {
      icon: '🔄',
      title: 'Total Trades',
      value: data.n_trades.toString(),
      isPositive: null
    },
    {
      icon: '✅',
      title: 'Win Rate',
      value: formatPercentage(winRate),
      isPositive: null
    }
  ]

  return (
    <div className="metrics-grid">
      {metrics.map((metric, index) => (
        <MetricCard
          key={index}
          icon={metric.icon}
          title={metric.title}
          value={metric.value}
          isPositive={metric.isPositive}
        />
      ))}
    </div>
  )
}

export default MetricsGrid 