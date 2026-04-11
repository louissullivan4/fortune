import { useState, useEffect } from 'react'
import { api, type UserProfile, type Invitation } from '../api/client'
import { pushToast } from '../components/Toasts'
import { Users, Mail, CheckCircle, XCircle, Shield, User } from 'lucide-react'

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

  useEffect(() => { load() }, [])

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

  async function toggleRole(u: UserProfile) {
    const newRole = u.user_role === 'admin' ? 'client' : 'admin'
    try {
      await api.users.setRole(u.user_id, newRole)
      pushToast(`${u.username} is now ${newRole}`, 'info')
      setUsers((prev) =>
        prev.map((user) =>
          user.user_id === u.user_id ? { ...user, user_role: newRole } : user
        )
      )
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  if (loading) return <div className="page"><p style={{ color: 'var(--muted)' }}>Loading…</p></div>

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
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>User</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Keys</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500 }}>{u.first_name} {u.last_name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>@{u.username}</div>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{u.email}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span className={`badge ${u.user_role === 'admin' ? 'badge-purple' : 'badge-blue'}`}>
                      {u.user_role}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <span className={`badge ${u.has_anthropic_key ? 'badge-green' : 'badge-red'}`} title="Anthropic">AI</span>
                      <span className={`badge ${u.has_t212_key ? 'badge-green' : 'badge-red'}`} title="T212">T212</span>
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
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                        onClick={() => toggleRole(u)}
                        title={u.user_role === 'admin' ? 'Make client' : 'Make admin'}
                      >
                        {u.user_role === 'admin' ? <User size={12} /> : <Shield size={12} />}
                      </button>
                      <button
                        className={`btn ${u.is_active ? 'btn-danger' : 'btn-primary'}`}
                        style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                        onClick={() => toggleActive(u)}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
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
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Email</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Invited By</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Sent</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Expires</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)' }}>Status</th>
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
