import { useEffect, useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  History as HistoryIcon,
  BarChart2,
  Settings,
  User,
  Shield,
  FlaskConical,
  LogOut,
} from 'lucide-react'
import Overview from '../pages/Dashboard'
import Performance from '../pages/Analytics'
import SignalsAndTrades from '../pages/Signals'
import Config from '../pages/Config'
import Profile from '../pages/Profile'
import Admin from '../pages/Admin'
import Backtest from '../pages/Backtest'
import { useAuth } from '../context/AuthContext'
import { setAccessToken, api, type EngineStatus, type UserMarketStatus } from '../api/client'
import MarketDropdown from './MarketDropdown'

type Role = 'admin' | 'client' | 'accountant'

const nav: Array<{
  to: string
  label: string
  icon: typeof LayoutDashboard
  roles?: Role[]
}> = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/performance', label: 'Performance', icon: BarChart2 },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/backtest', label: 'Backtest', icon: FlaskConical, roles: ['admin', 'accountant'] },
  { to: '/settings', label: 'Settings', icon: Settings },
]

interface Props {
  wsConnected: boolean
}

export default function Layout({ wsConnected: _wsConnected }: Props) {
  const { user, logout } = useAuth()
  const [_statuses, setStatuses] = useState<EngineStatus[]>([])
  const [_markets, setMarkets] = useState<UserMarketStatus[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const [s, m] = await Promise.all([api.engine.status(), api.markets.list()])
        setStatuses(s.statuses)
        setMarkets(m.markets)
      } catch {
        /* ignore */
      }
    }
    void load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  async function handleLogout() {
    await logout()
    setAccessToken(null)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-wordmark">Fortune</span>
        </div>

        <hr className="divider" />

        <div style={{ padding: '10px 12px 10px' }}>
          <MarketDropdown />
        </div>

        <hr className="divider" />

        <nav style={{ padding: '8px 0', flex: 1 }}>
          {nav
            .filter((item) => !item.roles || (user && item.roles.includes(user.role as Role)))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Icon size={15} style={{ flexShrink: 0 }} />
                <span className="nav-label">{label}</span>
              </NavLink>
            ))}

          <NavLink
            to="/profile"
            title="Profile"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <User size={15} style={{ flexShrink: 0 }} />
            <span className="nav-label">Profile</span>
          </NavLink>

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              title="Admin"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Shield size={15} style={{ flexShrink: 0 }} />
              <span className="nav-label">Admin</span>
            </NavLink>
          )}
        </nav>

        {/* Market filter + compact status per enabled market */}

        <hr className="divider" />

        <button
          className="nav-item"
          onClick={handleLogout}
          title="Sign out"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <LogOut size={15} style={{ flexShrink: 0 }} />
          <span className="nav-label">Sign out</span>
        </button>
      </aside>

      <div className="right-panel">
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/history" element={<SignalsAndTrades />} />
            <Route path="/signals-trades" element={<Navigate to="/history" replace />} />
            <Route path="/signals" element={<Navigate to="/history" replace />} />
            <Route path="/settings" element={<Config />} />
            <Route path="/config" element={<Navigate to="/settings" replace />} />
            <Route path="/profile" element={<Profile />} />
            {(user?.role === 'admin' || user?.role === 'accountant') && (
              <Route path="/backtest" element={<Backtest />} />
            )}
            {user?.role === 'admin' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
