import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import HistoricalPage from './pages/HistoricalPage'
import './App.css'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HistoricalPage />} />
        <Route path="/historical" element={<HistoricalPage />} />
      </Routes>
    </Layout>
  )
}

export default App
