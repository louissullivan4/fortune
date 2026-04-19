import { useEffect, useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  History as HistoryIcon,
  BarChart2,
  Settings,
  User,
  Shield,
  LogOut,
} from 'lucide-react'
import Overview from '../pages/Dashboard'
import Performance from '../pages/Analytics'
import SignalsAndTrades from '../pages/Signals'
import Config from '../pages/Config'
import Profile from '../pages/Profile'
import Admin from '../pages/Admin'
import { useAuth } from '../context/AuthContext'
import { setAccessToken, api, type EngineStatus } from '../api/client'

const nav = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/performance', label: 'Performance', icon: BarChart2 },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function isNYSEOpen(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return minutes >= 14 * 60 + 30 && minutes < 21 * 60
}

interface Props {
  wsConnected: boolean
}

export default function Layout({ wsConnected: _wsConnected }: Props) {
  const { user, logout } = useAuth()
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null)

  useEffect(() => {
    const load = () =>
      api.engine
        .status()
        .then(setEngineStatus)
        .catch(() => {})
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  async function handleLogout() {
    await logout()
    setAccessToken(null)
  }

  const nyseOpen = isNYSEOpen()

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-wordmark">Fortune</span>
        </div>

        <hr className="divider" />

        <nav style={{ padding: '8px 0', flex: 1 }}>
          {nav.map(({ to, label, icon: Icon }) => (
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

        <hr className="divider" />

        {/* Status indicators */}
        <div style={{ padding: '10px 16px 4px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* NYSE */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                background: nyseOpen ? '#16a34a' : 'var(--color-text-muted)',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              NYSE {nyseOpen ? 'open' : 'closed'}
            </span>
          </div>

          {/* Engine */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flexShrink: 0,
                background: engineStatus?.running ? '#16a34a' : 'var(--color-text-muted)',
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: engineStatus?.running
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-text-muted)',
              }}
            >
              Engine {engineStatus?.running ? 'running' : 'stopped'}
            </span>
          </div>
        </div>

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
            {user?.role === 'admin' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
