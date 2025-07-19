import { formatCurrency } from '../../utils/formatters'
import './DetailedStats.css'

const DetailedStats = ({ data }) => {
  const stats = [
    {
      label: 'Initial Capital:',
      value: formatCurrency(data.initial_capital)
    },
    {
      label: 'Total Entries:',
      value: data.n_entries.toString()
    },
    {
      label: 'Total Exits:',
      value: data.n_exits.toString()
    },
    {
      label: 'Buy Actions:',
      value: data.total_buy_actions.toString()
    },
    {
      label: 'Sell Actions:',
      value: data.total_sell_actions.toString()
    },
    {
      label: 'Winning Trades:',
      value: data.winning_trades.toString()
    },
    {
      label: 'Losing Trades:',
      value: data.losing_trades.toString()
    }
  ]

  return (
    <div className="detailed-stats">
      <div className="stats-card">
        <h3>Detailed Statistics</h3>
        <div className="stats-grid">
          {stats.map((stat, index) => (
            <div key={index} className="stat-item">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DetailedStats 