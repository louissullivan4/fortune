import PnLChart from '../PnLChart/PnLChart'
import ActivityChart from '../ActivityChart/ActivityChart'
import './ChartsSection.css'

const ChartsSection = ({ data }) => {
  return (
    <div className="charts-section">
      <div className="chart-container">
        <h3>Profit/Loss Distribution</h3>
        <PnLChart data={data} />
      </div>
      <div className="chart-container">
        <h3>Trading Activity</h3>
        <ActivityChart data={data} />
      </div>
    </div>
  )
}

export default ChartsSection 