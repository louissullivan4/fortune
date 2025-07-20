import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import LiveTradingPage from './pages/LiveTradingPage'
import StrategiesPage from './pages/StrategiesPage'
import CreateStrategyPage from './pages/CreateStrategyPage'
import StrategyTabsPage from './pages/StrategyTabsPage';
import StrategyTestPage from './pages/StrategyTestPage'
import ConfigPage from './pages/ConfigPage'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/live" replace />} />
        <Route path="/live" element={<LiveTradingPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/strategies/create" element={<CreateStrategyPage />} />
        <Route path="/strategies/:strategyId/edit" element={<StrategyTabsPage />} />
        <Route path="/strategies/:strategyId/test" element={<StrategyTestPage />} />
        <Route path="/settings" element={<ConfigPage />} />
      </Routes>
    </Layout>
  )
}

export default App
