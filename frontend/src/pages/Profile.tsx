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
    api.users
      .me()
      .then((p) => {
        setProfile(p)
        setProfileForm({
          first_name: p.first_name,
          last_name: p.last_name,
          username: p.username,
          dob: p.dob ?? '',
          phone: p.phone ?? '',
          address1: p.address1 ?? '',
          address2: p.address2 ?? '',
          city: p.city ?? '',
          county: p.county ?? '',
          country: p.country ?? '',
          zipcode: p.zipcode ?? '',
        })
      })
      .catch((err) => pushToast((err as Error).message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await api.users.updateMe(profileForm as Partial<UserProfile>)
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

  const displayName = profile?.username || profile?.first_name || profile?.email || '?'
  const initials = displayName.slice(0, 2).toUpperCase()
  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Profile header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--color-bg-raised)',
            border: '0.5px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
            {profile?.username || 'Profile'}
          </h1>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 4,
              fontSize: 12,
              color: 'var(--color-text-muted)',
            }}
          >
            <span>{profile?.email}</span>
            <span>·</span>
            <span>{user?.role}</span>
            {joinedDate && (
              <>
                <span>·</span>
                <span>Joined {joinedDate}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Personal information */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 20 }}>
          personal information
        </div>
        <form onSubmit={saveProfile}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 14,
              marginBottom: 14,
            }}
          >
            <Field label="First name">
              <input
                className="input"
                value={profileForm.first_name ?? ''}
                onChange={pf('first_name')}
              />
            </Field>
            <Field label="Last name">
              <input
                className="input"
                value={profileForm.last_name ?? ''}
                onChange={pf('last_name')}
              />
            </Field>
            <Field label="Username">
              <input
                className="input"
                value={profileForm.username ?? ''}
                onChange={pf('username')}
              />
            </Field>
          </div>

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}
          >
            <Field label="Date of birth">
              <input
                type="date"
                className="input"
                value={profileForm.dob ?? ''}
                onChange={pf('dob')}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                className="input"
                value={profileForm.phone ?? ''}
                onChange={pf('phone')}
              />
            </Field>
          </div>

          <button type="submit" className="btn btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>

      {/* Address */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 20 }}>
          address
        </div>
        <form onSubmit={saveProfile}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
            <Field label="Address line 1">
              <input
                className="input"
                value={profileForm.address1 ?? ''}
                onChange={pf('address1')}
              />
            </Field>
            <Field label="Address line 2">
              <input
                className="input"
                value={profileForm.address2 ?? ''}
                onChange={pf('address2')}
              />
            </Field>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}
          >
            <Field label="City">
              <input className="input" value={profileForm.city ?? ''} onChange={pf('city')} />
            </Field>
            <Field label="County / state">
              <input className="input" value={profileForm.county ?? ''} onChange={pf('county')} />
            </Field>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}
          >
            <Field label="Country">
              <input className="input" value={profileForm.country ?? ''} onChange={pf('country')} />
            </Field>
            <Field label="Postcode / zip">
              <input className="input" value={profileForm.zipcode ?? ''} onChange={pf('zipcode')} />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save address'}
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 20 }}>
          change password
        </div>
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
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}
          >
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
