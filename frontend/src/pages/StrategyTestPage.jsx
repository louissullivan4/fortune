import React, { useState, useEffect } from 'react';
import { getStrategy, runStrategyBacktest, getBacktestHistory } from '../services/api';
import { Line, Bar } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import { ChevronRight } from '@carbon/icons-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import Card, { MetricCard, ContentCard, InteractiveCard } from '../components/common/Card';
import Button from '../components/common/Button';
import './StrategyTestPage.css';
import '../components/common/CommonComponents.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const StrategyTestTab = ({ strategyId }) => {
  if (!strategyId) return <div style={{color: 'red'}}>No strategyId provided</div>;
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runningTest, setRunningTest] = useState(false);
  const [testHistory, setTestHistory] = useState([]);
  const [selectedTest, setSelectedTest] = useState(null);

  const [testParams, setTestParams] = useState({
    initial_capital: 1000,
    test_duration_days: 7
  });

  const [tradeFilter, setTradeFilter] = useState('all');

  const filteredTrades = selectedTest ?
    (tradeFilter === 'all' ? selectedTest.trades :
      selectedTest.trades.filter(tr => tradeFilter === 'win' ? tr.pnl >= 0 : tr.pnl < 0)) : [];

  if (filteredTrades.length > 0) {
    console.log('trade keys:', Object.keys(filteredTrades[0]));
  }

  useEffect(() => {
    fetchStrategy();
    fetchTestHistory();
  }, [strategyId]);

  const fetchStrategy = async () => {
    try {
      setLoading(true);
      const data = await getStrategy(strategyId);
      setStrategy(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch strategy');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTestHistory = async () => {
    try {
      const data = await getBacktestHistory(strategyId);
      setTestHistory(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunTest = async () => {
    try {
      setRunningTest(true);
      setError(null);
      const result = await runStrategyBacktest(strategyId, testParams);
      setSelectedTest(result);
      await fetchTestHistory();
    } catch (err) {
      setError(`Backtest failed: ${err.message}`);
    } finally {
      setRunningTest(false);
    }
  };

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  const formatPercent = (value) => `${value.toFixed(2)}%`;


  const renderTestForm = () => (
      <ContentCard title="Run Backtest" className="mb-6">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Initial Capital</label>
            <input
              className="form-input"
              type="number"
              value={testParams.initial_capital}
              onChange={e => setTestParams(p => ({ ...p, initial_capital: +e.target.value }))}
              min="1000"
              step="1000"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Duration (days)</label>
            <input
              className="form-input"
              type="number"
              value={testParams.test_duration_days}
              onChange={e => setTestParams(p => ({ ...p, test_duration_days: +e.target.value }))}
              min="1" max="365"
            />
          </div>
          <Button onClick={handleRunTest} loading={runningTest} fullWidth>
            {runningTest ? 'Running...' : 'Run Backtest'}
          </Button>
        </div>
      </ContentCard>
  );

  const renderHistory = () => (
    <ContentCard title="Backtest History" className="test-history">
      <div className="history-list">
        {testHistory.length === 0 && <div className="empty-history"><p>No backtests yet.</p></div>}
        {testHistory.map(ht => (
          <InteractiveCard
            key={ht.id}
            onClick={() => setSelectedTest(ht)}
            className={`history-item${selectedTest?.id === ht.id ? ' selected' : ''}`}
          >
            <div className="history-header">
              <span className="history-date">{new Date(ht.timestamp).toLocaleDateString()}</span>
              <span className={`history-profit ${ht.total_profit >= 0 ? 'profit' : 'loss'}`}>{formatCurrency(ht.total_profit)}</span>
            </div>
            <div className="history-details">
              <span><span>Return</span><span>{formatPercent(ht.return_pct)}</span></span>
              <span><span>Trades</span><span>{ht.total_trades}</span></span>
            </div>
          </InteractiveCard>
        ))}
      </div>
    </ContentCard>
  );

  const renderTestResults = (test) => {
    if (!test) return <div className="no-test-selected"><div className="no-test-icon">📊</div><h3>No Backtest Selected</h3><p>Select a backtest from the history or run a new one.</p></div>;

    const equityData = test.equity_curve.map(pt => ({
      x: pt.timestamp, // keep as timestamp for formatting in chart
      y: pt.equity
    }));

    const equityChart = {
      labels: equityData.map(d => d.x),
      datasets: [{
        label: 'Equity',
        data: equityData.map(d => d.y),
        fill: true,
        tension: 0.1,
        backgroundColor: 'rgba(0, 125, 121, 0.1)',
        borderColor: '#007d79',
        pointRadius: 0
      }]
    };

    const recentTrades = test.trades.slice(-20);
    const tradesData = recentTrades.map(tr => ({
      x: tr.exit_time, // keep as timestamp for formatting in chart
      y: tr.pnl
    }));

    const tradesChart = {
      labels: tradesData.map(d => d.x),
      datasets: [{
        label: 'P&L',
        data: tradesData.map(d => d.y),
        backgroundColor: '#007d79',
      }]
    };

    const axisColor = '#b0b0b0';
    const labelColor = '#081a1c';
    const gridColor = '#081a1c';
    const dateFormatter = (ts) => {
      const d = new Date(ts);
      // If time is always 00:00, just show date; else show date+time
      return d.getHours() === 0 && d.getMinutes() === 0
        ? d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
        : d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };
    const chartOptions = {
      responsive: true,
      plugins: {
        legend: {
          labels: { color: labelColor }
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0] ? dateFormatter(items[0].label) : ''
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: axisColor,
            callback: function(value, index, ticks) {
              return dateFormatter(this.getLabelForValue(value));
            },
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          },
          grid: { color: gridColor }
        },
        y: {
          ticks: { color: axisColor },
          grid: { color: gridColor }
        }
      }
    };

    // Chart options for equity curve: remove inner grid lines
    const equityChartOptions = {
      ...chartOptions,
      scales: {
        x: { ...chartOptions.scales.x, grid: { display: false } },
        y: { ...chartOptions.scales.y, grid: { display: false } }
      }
    };

    return (
      <ContentCard title="Backtest Results" className="test-results">
        <div className="metrics-grid mb-8">
          <MetricCard title="Total P&L" value={formatCurrency(test.total_profit)} status={test.total_profit >= 0 ? 'positive' : 'negative'} />
          <MetricCard title="Return" value={formatPercent(test.return_pct)} />
          <MetricCard title="Sharpe Ratio" value={test.sharpe_ratio.toFixed(2)} />
          <MetricCard title="Max Drawdown" value={formatPercent(test.max_drawdown)} />
          <MetricCard title="Win Rate" value={formatPercent(test.win_rate)} />
          <MetricCard title="Total Trades" value={test.total_trades} />
        </div>
        <div className="content-grid content-grid-2 charts-section">
          <Card className="chart-container">
            <h4>Equity Curve</h4>
            <div className="chart-wrapper"><Line data={equityChart} options={equityChartOptions} /></div>
          </Card>
          <Card className="chart-container">
            <h4>Recent Trades</h4>
            <div className="chart-wrapper"><Bar data={tradesChart} options={chartOptions} /></div>
          </Card>
        </div>
        <div className="section-header"><h4 className="section-title">Trade History</h4></div>
        <div className="trade-filter mb-2">
          <Button variant={tradeFilter === 'all' ? 'primary' : 'ghost'} size="sm" onClick={() => setTradeFilter('all')}>All</Button>
          <Button variant={tradeFilter === 'win' ? 'primary' : 'ghost'} size="sm" onClick={() => setTradeFilter('win')}>Winning</Button>
          <Button variant={tradeFilter === 'loss' ? 'primary' : 'ghost'} size="sm" onClick={() => setTradeFilter('loss')}>Losing</Button>
        </div>
        <div className="data-table mb-4">
          <table>
            <thead>
              <tr><th>Entry</th><th>Exit</th><th>P&L</th></tr>
            </thead>
            <tbody>
              {filteredTrades.map((tr, i) => (
                <tr key={i}>
                  <td>{new Date(tr.entry_time).toLocaleString()}</td>
                  <td>{new Date(tr.exit_time).toLocaleString()}</td>
                  <td className={tr.pnl >= 0 ? 'profit' : 'loss'}>
                    {formatCurrency(tr.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContentCard>
    );
  };

  if (loading) return <div className="test-main"><Button loading>Loading...</Button></div>;

  return (
    <div className="test-main">
      {error && <div className="error-message">{error}</div>}
      <div className="test-content">
        <div className="test-sidebar">
          {renderTestForm()}
          {renderHistory()}
        </div>
        <div className="test-results-section">
          {renderTestResults(selectedTest)}
        </div>
      </div>
    </div>
  );
};

export default StrategyTestTab;
