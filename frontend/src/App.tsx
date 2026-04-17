import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useWebSocket, type WsMessage } from './api/ws'
import Layout from './components/Layout'
import ToastContainer, { pushToast, type ToastLevel } from './components/Toasts'
import Login from './pages/Login'
import CreateAccount from './pages/CreateAccount'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import { useAuth } from './context/AuthContext'
import { setAccessToken } from './api/client'

// ── Auto-refresh token on app load ─────────────────────────────────────────
function useTokenBootstrap() {
  const { setAuth } = useAuth()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (res.ok) {
          const { accessToken } = await res.json()
          setAccessToken(accessToken)
          // Fetch user info
          const meRes = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: 'include',
          })
          if (meRes.ok) {
            const user = await meRes.json()
            setAuth(accessToken, {
              userId: user.user_id,
              email: user.email,
              role: user.user_role,
              firstName: user.first_name,
            })
          }
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [setAuth])

  return ready
}

// ── Protected wrapper ──────────────────────────────────────────────────────
function ProtectedApp() {
  const { user } = useAuth()
  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.event === 'toast') {
      const d = msg.data as { message: string; level: ToastLevel }
      pushToast(d.message, d.level)
    }
  }, [])
  const { connected } = useWebSocket(handleMessage)

  if (!user) return <Navigate to="/login" replace />
  return <Layout wsConnected={connected} />
}

export default function App() {
  const { user } = useAuth()
  const ready = useTokenBootstrap()

  if (!ready) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--muted)',
        }}
      >
        Loading…
      </div>
    )
  }

  return (
    <>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/create-account" element={<CreateAccount />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Protected app */}
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
      <ToastContainer />
    </>
  )
}
