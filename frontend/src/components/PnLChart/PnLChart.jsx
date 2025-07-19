import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import './PnLChart.css'

ChartJS.register(ArcElement, Tooltip, Legend)

const PnLChart = ({ data }) => {
  const chartData = {
    labels: ['Winning Trades', 'Losing Trades'],
    datasets: [
      {
        data: [data.winning_trades, data.losing_trades],
        backgroundColor: ['#00d4aa', '#ff6b6b'],
        borderWidth: 0,
        hoverOffset: 4
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true,
          font: {
            size: 12,
            family: 'Inter'
          }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true
      }
    }
  }

  return (
    <div className="pnl-chart">
      <Doughnut data={chartData} options={options} />
    </div>
  )
}

export default PnLChart 