import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { setAccessToken, api } from '../api/client'

export default function CreateAccount() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { setAuth } = useAuth()

  const [inviteEmail, setInviteEmail] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokenValid, setTokenValid] = useState(false)

  const [form, setForm] = useState({
    username: '',
    firstName: '',
    lastName: '',
    password: '',
    confirmPassword: '',
    dob: '',
    address1: '',
    address2: '',
    city: '',
    county: '',
    country: '',
    zipcode: '',
    phone: '',
  })

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) {
      setTokenError('No invitation token provided.')
      return
    }
    api.auth
      .verifyInvite(token)
      .then((data) => {
        setInviteEmail(data.email)
        setTokenValid(true)
      })
      .catch((err) => setTokenError((err as Error).message))
  }, [token])

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const data = await api.auth.createAccount({
        token,
        password: form.password,
        username: form.username,
        firstName: form.firstName,
        lastName: form.lastName,
        dob: form.dob,
        address1: form.address1,
        address2: form.address2,
        city: form.city,
        county: form.county,
        country: form.country,
        zipcode: form.zipcode,
        phone: form.phone,
      })
      setAccessToken(data.accessToken)
      setAuth(data.accessToken, data.user)
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (tokenError) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Invalid Invitation</h1>
          <div className="auth-error">{tokenError}</div>
        </div>
      </div>
    )
  }

  if (!tokenValid) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p style={{ color: 'var(--muted)' }}>Verifying invitation…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-logo">
          <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>Fortune</span>
        </div>
        <h1 className="auth-title">Create Account</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
          Creating account for <strong>{inviteEmail}</strong>
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="auth-label">First Name *</label>
              <input
                className="auth-input"
                value={form.firstName}
                onChange={set('firstName')}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="auth-label">Last Name *</label>
              <input
                className="auth-input"
                value={form.lastName}
                onChange={set('lastName')}
                required
              />
            </div>
          </div>

          <label className="auth-label">Username *</label>
          <input className="auth-input" value={form.username} onChange={set('username')} required />

          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="auth-label">Password *</label>
              <input
                type="password"
                className="auth-input"
                value={form.password}
                onChange={set('password')}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="auth-label">Confirm Password *</label>
              <input
                type="password"
                className="auth-input"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                required
              />
            </div>
          </div>

          <label className="auth-label">Date of Birth</label>
          <input type="date" className="auth-input" value={form.dob} onChange={set('dob')} />

          <label className="auth-label">Address Line 1</label>
          <input className="auth-input" value={form.address1} onChange={set('address1')} />

          <label className="auth-label">Address Line 2</label>
          <input className="auth-input" value={form.address2} onChange={set('address2')} />

          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="auth-label">City</label>
              <input className="auth-input" value={form.city} onChange={set('city')} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="auth-label">County / State</label>
              <input className="auth-input" value={form.county} onChange={set('county')} />
            </div>
          </div>

          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="auth-label">Country</label>
              <input className="auth-input" value={form.country} onChange={set('country')} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="auth-label">Postcode / Zipcode</label>
              <input className="auth-input" value={form.zipcode} onChange={set('zipcode')} />
            </div>
          </div>

          <label className="auth-label">Phone</label>
          <input type="tel" className="auth-input" value={form.phone} onChange={set('phone')} />

          <button type="submit" className="btn btn-primary auth-btn" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
