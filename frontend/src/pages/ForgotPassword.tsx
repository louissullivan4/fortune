import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.auth.forgotPassword(email)
      setSent(true)
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
          <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>Fortune</span>
        </div>
        <h1 className="auth-title">Forgot Password</h1>

        {sent ? (
          <div>
            <div className="auth-success">
              If an account with that email exists, a password reset link has been sent.
            </div>
            <Link to="/login" className="auth-link" style={{ display: 'block', marginTop: 16 }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
              Enter your email and we will send you a reset link.
            </p>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit} className="auth-form">
              <label className="auth-label">Email</label>
              <input
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
              <button type="submit" className="btn btn-primary auth-btn" disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
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
