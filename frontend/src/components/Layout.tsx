import { useEffect, useState } from 'react'
import { NavLink, Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import MarketClock from './MarketClock'
import { getMarketSpec } from '../markets/registry'

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

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/overview')) return 'Overview'
  if (pathname.startsWith('/performance')) return 'Performance'
  if (pathname.startsWith('/history')) return 'History'
  if (pathname.startsWith('/backtest')) return 'Backtest'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/profile')) return 'Profile'
  if (pathname.startsWith('/admin')) return 'Admin'
  return ''
}

export default function Layout({ wsConnected: _wsConnected }: Props) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [statuses, setStatuses] = useState<EngineStatus[]>([])
  const [markets, setMarkets] = useState<UserMarketStatus[]>([])

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

  const enabledMarkets = markets.filter((m) => m.enabled)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-wordmark">Fortune</span>
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

        <hr className="divider" />

        {/* Stacked market clocks + engine statuses, one row per enabled market */}
        <div style={{ padding: '10px 16px 4px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(enabledMarkets.length > 0
            ? enabledMarkets
            : [{ code: 'NYSE' } as UserMarketStatus]
          ).map((m) => {
            let spec
            try {
              spec = getMarketSpec(m.code)
            } catch {
              return null
            }
            const engine = statuses.find((s) => s.market === m.code)
            return (
              <div key={m.code} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <MarketClock spec={spec} compact />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 0 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: engine?.running ? '#16a34a' : 'var(--color-text-muted)',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: engine?.running
                        ? 'var(--color-text-secondary)'
                        : 'var(--color-text-muted)',
                    }}
                  >
                    Engine {engine?.running ? 'running' : 'stopped'}
                  </span>
                </div>
              </div>
            )
          })}
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
        {/* Header strip with page title + market dropdown */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 24px',
            borderBottom: '0.5px solid var(--color-border)',
            background: 'var(--color-bg-page)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {pageTitle(location.pathname)}
          </span>
          <MarketDropdown />
        </div>

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
