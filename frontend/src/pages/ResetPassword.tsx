import { useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      await api.auth.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="sidebar-logo-icon">T</span>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, marginLeft: 8 }}>Trader</span>
        </div>
        <h1 className="auth-title">Reset Password</h1>

        {done ? (
          <div className="auth-success">Password reset successfully. Redirecting to sign in…</div>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-label">New Password</label>
              <input
                type="password"
                className="auth-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
              />
              <label className="auth-label">Confirm Password</label>
              <input
                type="password"
                className="auth-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary auth-btn"
                disabled={loading || !token}
              >
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
            </form>
            <Link to="/login" className="auth-link" style={{ display: 'block', marginTop: 16 }}>
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
