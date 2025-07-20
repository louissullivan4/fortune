import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { 
  Lightning,
  ChartScatter,
  Settings,
  Menu,
  Close
} from '@carbon/icons-react'
import { IconButton } from '../common/Button'
import { NAV_ITEMS } from '../../utils/constants'
import './Layout.css'

const Layout = ({ children }) => {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)
  const closeSidebar = () => setSidebarOpen(false)

  const getIconForPath = (path) => {
    switch (path) {
      case '/live':
        return Lightning
      case '/strategies':
        return ChartScatter
      case '/settings':
        return Settings
      default:
        return Lightning
    }
  }

  return (
    <div className="layout">
      {/* Mobile Menu Toggle */}
      <button
        className="mobile-menu-toggle"
        onClick={toggleSidebar}
        aria-label="Toggle navigation menu"
      >
        <Menu size={20} />
      </button>

      {/* Sidebar Backdrop */}
      <div 
        className={`sidebar-backdrop ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>Fortune Trading</h1>
          <p>Strategy Dashboard</p>
        </div>
        
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, index) => {
            const IconComponent = getIconForPath(item.path)
            const isActive = location.pathname === item.path
            
            return (
              <Link 
                key={index}
                to={item.path} 
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <span className="nav-icon">
                  <IconComponent size={20} />
                </span>
                <span className="nav-text">{item.text}</span>
              </Link>
            )
          })}
        </nav>

        {/* Mobile Close Button */}
        <div className="lg:hidden p-4 border-t border-gray-200">
          <IconButton
            icon={Close}
            onClick={closeSidebar}
            variant="ghost"
            size="small"
            className="w-full justify-center"
            aria-label="Close navigation"
          >
            Close Menu
          </IconButton>
        </div>
      </aside>
      
      {/* Main Container */}
      <div className="main-container">
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}

export default Layout 