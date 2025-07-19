import { Link, useLocation } from 'react-router-dom'
import './Layout.css'

const Layout = ({ children }) => {
  const location = useLocation()

  return (
    <div className="layout">
      <header className="header">
        <div className="header-content">
          <h1>📈 Fortune Trading Dashboard</h1>
          <p>Real-time strategy performance analysis</p>
        </div>
        <nav className="navigation">
          <Link 
            to="/historical" 
            className={`nav-link ${location.pathname === '/historical' || location.pathname === '/' ? 'active' : ''}`}
          >
            Historical Analysis
          </Link>
        </nav>
      </header>
      
      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

export default Layout 