import { useState, useEffect } from 'react'
import { Eye, EyeOff, ChevronDown } from 'lucide-react'
import { api, type UserProfile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { pushToast } from '../components/Toasts'

function Field({
  label,
  optional,
  children,
  error,
}: {
  label: string
  optional?: boolean
  children: React.ReactNode
  error?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
        {label}
        {optional && (
          <span style={{ marginLeft: 4, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            (optional)
          </span>
        )}
      </label>
      {children}
      {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
    </div>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{ paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'flex',
          padding: 2,
        }}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

function passwordScore(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const score = passwordScore(password)
  const label = score <= 1 ? 'weak' : score <= 2 ? 'fair' : 'strong'
  const color = score <= 1 ? '#dc2626' : score <= 2 ? '#ca8a04' : '#16a34a'
  const width = `${(score / 4) * 100}%`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: 'var(--color-bg-raised)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width,
            background: color,
            borderRadius: 2,
            transition: 'width 150ms ease, background 150ms ease',
          }}
        />
      </div>
      <span style={{ fontSize: 11, color }}>{label}</span>
    </div>
  )
}

function AccordionSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span className="section-label">{label}</span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--color-text-muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
          }}
        />
      </button>
      {open && <div style={{ marginTop: 20 }}>{children}</div>}
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

  const [addressOpen, setAddressOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

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
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : null

  const addressDuplicate =
    profileForm.address1 &&
    profileForm.address2 &&
    profileForm.address1 !== '' &&
    profileForm.address1 === profileForm.address2

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start' }}
    >
      {/* Left: identity card */}
      <div style={{ position: 'sticky', top: 'var(--header-height)' }}>
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
            padding: 24,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'var(--color-bg-raised)',
              border: '0.5px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
            }}
          >
            {initials}
          </div>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                marginBottom: 4,
              }}
            >
              {profile?.first_name && profile?.last_name
                ? `${profile.first_name} ${profile.last_name}`
                : profile?.username || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              {profile?.email}
            </div>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 9999,
                background: 'var(--color-bg-raised)',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
              }}
            >
              {user?.role}
            </span>
          </div>
          {joinedDate && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                borderTop: '0.5px solid var(--color-border)',
                paddingTop: 12,
                width: '100%',
              }}
            >
              Member since {joinedDate}
            </div>
          )}
        </div>
      </div>

      {/* Right: forms */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: '0 0 16px' }}>Profile</h1>

        {/* Personal information */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-label" style={{ marginBottom: 20 }}>
            personal information
          </div>
          <form onSubmit={saveProfile}>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}
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
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}
            >
              <Field label="Username">
                <input
                  className="input"
                  value={profileForm.username ?? ''}
                  onChange={pf('username')}
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
            <div style={{ marginBottom: 20 }}>
              <Field label="Date of birth">
                <input
                  type="date"
                  className="input"
                  value={profileForm.dob ?? ''}
                  onChange={pf('dob')}
                />
              </Field>
            </div>
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </form>
        </div>

        {/* Address — collapsible */}
        <AccordionSection
          label="address"
          open={addressOpen}
          onToggle={() => setAddressOpen((o) => !o)}
        >
          <form onSubmit={saveProfile}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
              <Field label="Address line 1">
                <input
                  className="input"
                  value={profileForm.address1 ?? ''}
                  onChange={pf('address1')}
                />
              </Field>
              <Field
                label="Address line 2"
                optional
                error={addressDuplicate ? 'Address line 2 cannot be the same as line 1' : undefined}
              >
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
                <input
                  className="input"
                  value={profileForm.country ?? ''}
                  onChange={pf('country')}
                />
              </Field>
              <Field label="Postcode / zip">
                <input
                  className="input"
                  value={profileForm.zipcode ?? ''}
                  onChange={pf('zipcode')}
                />
              </Field>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingProfile || !!addressDuplicate}
            >
              {savingProfile ? 'Saving…' : 'Save address'}
            </button>
          </form>
        </AccordionSection>

        {/* Password — collapsible */}
        <AccordionSection
          label="change password"
          open={passwordOpen}
          onToggle={() => setPasswordOpen((o) => !o)}
        >
          <form onSubmit={savePassword}>
            <div style={{ marginBottom: 14 }}>
              <Field label="Current password">
                <PasswordInput
                  value={pwForm.currentPassword}
                  onChange={(v) => setPwForm((f) => ({ ...f, currentPassword: v }))}
                  required
                />
              </Field>
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 8 }}
            >
              <Field label="New password">
                <PasswordInput
                  value={pwForm.newPassword}
                  onChange={(v) => setPwForm((f) => ({ ...f, newPassword: v }))}
                  required
                />
              </Field>
              <Field label="Confirm new password">
                <PasswordInput
                  value={pwForm.confirm}
                  onChange={(v) => setPwForm((f) => ({ ...f, confirm: v }))}
                  required
                />
              </Field>
            </div>
            <div style={{ marginBottom: 16 }}>
              <PasswordStrength password={pwForm.newPassword} />
            </div>
            {pwForm.confirm && pwForm.newPassword !== pwForm.confirm && (
              <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 12 }}>
                Passwords do not match
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                savingPw ||
                !pwForm.currentPassword ||
                !pwForm.newPassword ||
                pwForm.newPassword !== pwForm.confirm
              }
            >
              {savingPw ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </AccordionSection>
      </div>
    </div>
  )
}
