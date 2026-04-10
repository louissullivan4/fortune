import { useState } from 'react'
import { NavLink, Routes, Route } from 'react-router-dom'
import {
  LayoutDashboard,
  Zap,
  Clock,
  BarChart2,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import Dashboard from '../pages/Dashboard'
import Signals from '../pages/Signals'
import History from '../pages/History'
import Analytics from '../pages/Analytics'
import Config from '../pages/Config'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/signals', label: 'Signals', icon: Zap },
  { to: '/history', label: 'History', icon: Clock },
  { to: '/analytics', label: 'Analytics', icon: BarChart2 },
  { to: '/config', label: 'Config', icon: Settings },
]

interface Props {
  wsConnected: boolean
}

export default function Layout({ wsConnected: _wsConnected }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className={`layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">T</span>
          <span className="sidebar-logo-text">Trader</span>
        </div>

        <hr className="divider" />

        <nav style={{ padding: '8px 0', flex: 1 }}>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={16} />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <hr className="divider" />

        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          <span className="nav-label">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/history" element={<History />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/config" element={<Config />} />
        </Routes>
      </main>
    </div>
  )
}
