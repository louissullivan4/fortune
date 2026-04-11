import { useState, useEffect } from 'react'
import { api, type UserProfile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { pushToast } from '../components/Toasts'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export default function Profile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({})
  const [savingProfile, setSavingProfile] = useState(false)

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    api.users.me()
      .then((p) => {
        setProfile(p)
        setProfileForm({
          first_name: p.first_name,
          last_name: p.last_name,
          username: p.username,
          dob: p.dob ?? '',
          address1: p.address1 ?? '',
          address2: p.address2 ?? '',
          city: p.city ?? '',
          county: p.county ?? '',
          country: p.country ?? '',
          zipcode: p.zipcode ?? '',
          phone: p.phone ?? '',
        })
      })
      .catch((err) => pushToast((err as Error).message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await api.users.updateMe({
        first_name: profileForm.first_name,
        last_name: profileForm.last_name,
        username: profileForm.username,
        dob: profileForm.dob || undefined,
        address1: profileForm.address1 || undefined,
        address2: profileForm.address2 || undefined,
        city: profileForm.city || undefined,
        county: profileForm.county || undefined,
        country: profileForm.country || undefined,
        zipcode: profileForm.zipcode || undefined,
        phone: profileForm.phone || undefined,
      } as Partial<UserProfile>)
      pushToast('Profile updated', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwForm.newPassword !== pwForm.confirm) {
      pushToast('Passwords do not match', 'error')
      return
    }
    setSavingPw(true)
    try {
      await api.users.updatePassword(pwForm.currentPassword, pwForm.newPassword)
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' })
      pushToast('Password updated', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSavingPw(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</div>

  function pf(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setProfileForm((f) => ({ ...f, [field]: e.target.value }))
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Profile</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {profile?.email} · {user?.role}
        </p>
      </div>

      {/* Personal Information */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 20 }}>personal information</div>
        <form onSubmit={saveProfile}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="First name">
              <input className="input" value={profileForm.first_name ?? ''} onChange={pf('first_name')} />
            </Field>
            <Field label="Last name">
              <input className="input" value={profileForm.last_name ?? ''} onChange={pf('last_name')} />
            </Field>
          </div>

          <div style={{ marginBottom: 14 }}>
            <Field label="Username">
              <input className="input" value={profileForm.username ?? ''} onChange={pf('username')} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="Date of birth">
              <input type="date" className="input" value={profileForm.dob ?? ''} onChange={pf('dob')} />
            </Field>
            <Field label="Phone">
              <input type="tel" className="input" value={profileForm.phone ?? ''} onChange={pf('phone')} />
            </Field>
          </div>

          <div style={{ marginBottom: 14 }}>
            <Field label="Address line 1">
              <input className="input" value={profileForm.address1 ?? ''} onChange={pf('address1')} />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Field label="Address line 2">
              <input className="input" value={profileForm.address2 ?? ''} onChange={pf('address2')} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Field label="City">
              <input className="input" value={profileForm.city ?? ''} onChange={pf('city')} />
            </Field>
            <Field label="County / state">
              <input className="input" value={profileForm.county ?? ''} onChange={pf('county')} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <Field label="Country">
              <input className="input" value={profileForm.country ?? ''} onChange={pf('country')} />
            </Field>
            <Field label="Postcode / zip">
              <input className="input" value={profileForm.zipcode ?? ''} onChange={pf('zipcode')} />
            </Field>
          </div>

          <button type="submit" className="btn btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>

      {/* Change Password */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 20 }}>change password</div>
        <form onSubmit={savePassword}>
          <div style={{ marginBottom: 14 }}>
            <Field label="Current password">
              <input
                type="password"
                className="input"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                required
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <Field label="New password">
              <input
                type="password"
                className="input"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                className="input"
                value={pwForm.confirm}
                onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                required
              />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingPw}>
            {savingPw ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
