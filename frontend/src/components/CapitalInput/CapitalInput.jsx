import { useState } from 'react'
import './CapitalInput.css'

const CapitalInput = ({ onAnalyze }) => {
  const [initialCapital, setInitialCapital] = useState(10000)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (initialCapital > 0) {
      onAnalyze(initialCapital)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e)
    }
  }

  return (
    <div className="input-section">
      <div className="input-card">
        <h2>Initial Capital</h2>
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <span className="currency">$</span>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              onKeyPress={handleKeyPress}
              placeholder="10000"
              min="100"
              step="100"
            />
          </div>
          <button type="submit" className="analyze-btn">
            Analyze Performance
          </button>
        </form>
      </div>
    </div>
  )
}

export default CapitalInput 