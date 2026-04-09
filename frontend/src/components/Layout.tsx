import { NavLink, Routes, Route } from 'react-router-dom'
import { LayoutDashboard, Zap, Clock, BarChart2, Settings, Wifi, WifiOff } from 'lucide-react'
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

export default function Layout({ wsConnected }: Props) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div style={{ padding: '20px 16px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
            Trader
          </div>
        </div>

        <hr className="divider" />

        <nav style={{ padding: '8px 0', flex: 1 }}>
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <hr className="divider" />

        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
          {wsConnected
            ? <Wifi size={13} style={{ color: '#16a34a' }} />
            : <WifiOff size={13} style={{ color: 'var(--color-text-muted)' }} />}
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {wsConnected ? 'live' : 'reconnecting...'}
          </span>
        </div>
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
