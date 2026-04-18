import { useState, useEffect, useRef } from 'react'
import { api, type UserProfile, type Invitation } from '../api/client'
import { pushToast } from '../components/Toasts'
import { Users, Mail, CheckCircle, XCircle } from 'lucide-react'

type UserRole = 'admin' | 'client' | 'accountant'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  client: 'Client',
  accountant: 'Accountant',
}

function RolePicker({
  userId,
  currentRole,
  onChanged,
}: {
  userId: string
  currentRole: string
  onChanged: (newRole: UserRole) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function pick(role: UserRole) {
    setOpen(false)
    if (role === currentRole) return
    try {
      await api.users.setRole(userId, role)
      onChanged(role)
      pushToast(`Role changed to ${ROLE_LABELS[role]}`, 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  const roleBadgeClass =
    currentRole === 'admin'
      ? 'badge-purple'
      : currentRole === 'accountant'
        ? 'badge-yellow'
        : 'badge-blue'

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={`badge ${roleBadgeClass}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          cursor: 'pointer',
          border: '0.5px solid transparent',
          paddingRight: 10,
          background: 'none',
        }}
        title="Change role"
      >
        {currentRole} ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 200,
            marginTop: 4,
            background: 'var(--color-bg-page)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 6,
            overflow: 'hidden',
            minWidth: 120,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {(['client', 'accountant', 'admin'] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => pick(role)}
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 12px',
                textAlign: 'left',
                background: role === currentRole ? 'var(--color-bg-raised)' : 'transparent',
                border: 'none',
                fontSize: 13,
                fontWeight: role === currentRole ? 500 : 400,
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [tab, setTab] = useState<'users' | 'invitations'>('users')

  function load() {
    return Promise.all([api.users.list(), api.users.invitations()])
      .then(([u, i]) => {
        setUsers(u)
        setInvitations(i)
      })
      .catch((err) => pushToast((err as Error).message, 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      await api.users.invite(inviteEmail)
      pushToast(`Invitation sent to ${inviteEmail}`, 'info')
      setInviteEmail('')
      load()
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setInviting(false)
    }
  }

  async function toggleActive(u: UserProfile) {
    try {
      await api.users.setActive(u.user_id, !u.is_active)
      pushToast(`${u.username} ${u.is_active ? 'deactivated' : 'activated'}`, 'info')
      setUsers((prev) =>
        prev.map((user) =>
          user.user_id === u.user_id ? { ...user, is_active: !user.is_active } : user
        )
      )
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  function handleRoleChanged(userId: string, newRole: UserRole) {
    setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, user_role: newRole } : u)))
  }

  if (loading)
    return (
      <div className="page">
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    )

  return (
    <div className="page">
      <h1 className="page-title">Admin Dashboard</h1>

      {/* Invite user */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 className="section-title">
          <Mail size={16} style={{ marginRight: 6 }} />
          Invite New User
        </h2>
        <form onSubmit={sendInvite} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="auth-label">Email address</label>
            <input
              type="email"
              className="auth-input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="new-user@example.com"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={inviting}>
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
      </section>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('users')}
        >
          <Users size={14} /> Users ({users.length})
        </button>
        <button
          className={`btn ${tab === 'invitations' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('invitations')}
        >
          <Mail size={14} /> Invitations ({invitations.length})
        </button>
      </div>

      {tab === 'users' && (
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  User
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Email
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Role
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Keys
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Status
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>
                      {u.first_name} {u.last_name}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>@{u.username}</div>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <RolePicker
                      userId={u.user_id}
                      currentRole={u.user_role}
                      onChanged={(role) => handleRoleChanged(u.user_id, role)}
                    />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <span
                        className={`badge ${u.has_anthropic_key ? 'badge-green' : 'badge-red'}`}
                        title="Anthropic"
                      >
                        AI
                      </span>
                      <span
                        className={`badge ${u.has_t212_key ? 'badge-green' : 'badge-red'}`}
                        title="T212"
                      >
                        T212
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {u.is_active ? (
                      <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                    ) : (
                      <XCircle size={14} style={{ color: 'var(--danger)' }} />
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      className={`btn ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                      style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                      onClick={() => toggleActive(u)}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'invitations' && (
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Email
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Invited By
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Sent
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Expires
                </th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const expired = new Date(inv.expires_at) < new Date()
                const status = inv.is_used ? 'used' : expired ? 'expired' : 'pending'
                return (
                  <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>{inv.email}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {inv.invited_by_username ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        className={`badge ${status === 'used' ? 'badge-green' : status === 'expired' ? 'badge-red' : 'badge-blue'}`}
                      >
                        {status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
