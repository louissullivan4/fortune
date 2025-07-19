import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import './ActivityChart.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip
)

const ActivityChart = ({ data }) => {
  const chartData = {
    labels: ['Buy Actions', 'Sell Actions', 'Entries', 'Exits'],
    datasets: [
      {
        data: [
          data.total_buy_actions,
          data.total_sell_actions,
          data.n_entries,
          data.n_exits
        ],
        backgroundColor: ['#667eea', '#764ba2', '#00d4aa', '#ff6b6b'],
        borderWidth: 0,
        borderRadius: 8,
        borderSkipped: false
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: false
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
          drawBorder: false
        },
        ticks: {
          font: {
            family: 'Inter',
            size: 12
          },
          color: '#666'
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          font: {
            family: 'Inter',
            size: 12
          },
          color: '#666'
        }
      }
    }
  }

  return (
    <div className="activity-chart">
      <Bar data={chartData} options={options} />
    </div>
  )
}

export default ActivityChart 