import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { 
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
          <div className="logo-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="#ffffff"/>
              <path d="M6 22L10 18L14 20L18 14L22 16L26 10" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="10" cy="18" r="1.5" fill="#000000"/>
              <circle cx="14" cy="20" r="1.5" fill="#000000"/>
              <circle cx="18" cy="14" r="1.5" fill="#000000"/>
              <circle cx="22" cy="16" r="1.5" fill="#000000"/>
              <circle cx="26" cy="10" r="1.5" fill="#000000"/>
            </svg>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, index) => {
            const IconComponent = item.icon
            const isActive = location.pathname === item.path
            
            return (
              <Link 
                key={index}
                to={item.path} 
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
                title={item.text}
              >
                <span className="nav-icon">
                  <IconComponent size={24} />
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Mobile Close Button */}
        <div className="lg:hidden p-4 border-t border-gray-600">
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