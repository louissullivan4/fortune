import './MetricCard.css'

const MetricCard = ({ icon, title, value, isPositive }) => {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div className="metric-content">
        <h3>{title}</h3>
        <p className={`metric-value ${isPositive !== null ? (isPositive ? 'positive' : 'negative') : ''}`}>
          {value}
        </p>
      </div>
    </div>
  )
}

export default MetricCard 