import { useState } from 'react'
import CapitalInput from '../components/CapitalInput/CapitalInput'
import MetricsGrid from '../components/MetricsGrid/MetricsGrid'
import ChartsSection from '../components/ChartsSection/ChartsSection'
import DetailedStats from '../components/DetailedStats/DetailedStats'
import LoadingSpinner from '../components/LoadingSpinner/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage/ErrorMessage'
import { analyzePerformance } from '../services/api'
import './HistoricalPage.css'

const HistoricalPage = () => {
  const [analysisData, setAnalysisData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleAnalyze = async (initialCapital) => {
    setLoading(true)
    setError(null)
    setAnalysisData(null)

    try {
      const data = await analyzePerformance(initialCapital)
      setAnalysisData(data)
    } catch (err) {
      setError(err.message || 'Failed to analyze performance')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="historical-page">
      <CapitalInput onAnalyze={handleAnalyze} />
      
      {loading && <LoadingSpinner />}
      
      {error && <ErrorMessage message={error} />}
      
      {analysisData && (
        <div className="results-section">
          <MetricsGrid data={analysisData} />
          <ChartsSection data={analysisData} />
          <DetailedStats data={analysisData} />
        </div>
      )}
    </div>
  )
}

export default HistoricalPage 