import { useEffect, useState, useMemo } from 'react'
import { Download, X } from 'lucide-react'
import { api, type ReportUser } from '../api/client.js'
import { useAuth } from '../context/AuthContext.js'
import { pushToast } from './Toasts.js'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const COLOR_RED = '#dc2626'

export default function ExportReportModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const isPrivileged = user?.role === 'admin' || user?.role === 'accountant'

  const [reportUsers, setReportUsers] = useState<ReportUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>(user?.userId ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (isPrivileged) {
      api.analytics
        .reportUsers()
        .then(setReportUsers)
        .catch(() => {})
    }
  }, [isPrivileged])

  const dayCount = useMemo(() => {
    if (!from || !to) return 0
    return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1
  }, [from, to])

  const rangeError =
    from && to && new Date(from) > new Date(to)
      ? 'Start date must be before end date'
      : dayCount > 366
        ? `Range is ${dayCount} days — max 366`
        : null

  async function handleGenerate() {
    if (rangeError || !from || !to) return
    setGenerating(true)
    try {
      const blob = await api.analytics.report({
        userId: isPrivileged && selectedUserId !== user?.userId ? selectedUserId : undefined,
        from,
        to,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report-${from}-to-${to}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    height: 32,
    padding: '0 8px',
    width: '100%',
    boxSizing: 'border-box',
    border: '0.5px solid var(--color-border)',
    borderRadius: 4,
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    outline: 'none',
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-page)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 8,
          width: 360,
          maxWidth: '95vw',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '0.5px solid var(--color-border)',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>Generate performance report</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              padding: 2,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isPrivileged && reportUsers.length > 0 && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--color-text-muted)',
                  marginBottom: 6,
                }}
              >
                User
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                style={{ ...inputStyle }}
              >
                {reportUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.first_name} {u.last_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                }}
              >
                From
              </label>
              <input
                type="date"
                value={from}
                max={to || todayStr()}
                onChange={(e) => setFrom(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  marginBottom: 4,
                }}
              >
                To
              </label>
              <input
                type="date"
                value={to}
                min={from}
                max={todayStr()}
                onChange={(e) => setTo(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {rangeError && <div style={{ fontSize: 12, color: COLOR_RED }}>{rangeError}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating || !!rangeError || !from || !to}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={13} />
              {generating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
