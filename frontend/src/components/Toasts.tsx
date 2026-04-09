import { useEffect, useState } from 'react'
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react'

export type ToastLevel = 'info' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  level: ToastLevel
}

let _nextId = 1
let _addToast: ((t: Omit<Toast, 'id'>) => void) | null = null

export function pushToast(message: string, level: ToastLevel = 'info') {
  _addToast?.({ message, level })
}

const LEVEL_STYLE: Record<ToastLevel, { bg: string; border: string; color: string; icon: React.ReactNode }> = {
  info:    { bg: 'var(--color-bg-surface)', border: 'var(--color-border)',       color: 'var(--color-text-primary)',  icon: <Info size={14} /> },
  warning: { bg: '#fefce8',                 border: 'rgba(202,138,4,0.4)',        color: '#854d0e',                    icon: <AlertTriangle size={14} /> },
  error:   { bg: '#fef2f2',                 border: 'rgba(220,38,38,0.35)',       color: '#991b1b',                    icon: <AlertCircle size={14} /> },
}

const DURATION_MS = 5000

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    _addToast = (t) => {
      const id = _nextId++
      setToasts((prev) => [...prev, { ...t, id }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id))
      }, DURATION_MS)
    }
    return () => { _addToast = null }
  }, [])

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id))

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 360,
    }}>
      {toasts.map((t) => {
        const s = LEVEL_STYLE[t.level]
        return (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              background: s.bg,
              border: `0.5px solid ${s.border}`,
              borderRadius: 6,
              color: s.color,
              fontSize: 13,
              lineHeight: 1.4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              animation: 'toast-in 150ms ease',
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'inherit', opacity: 0.6, padding: 0, flexShrink: 0,
                display: 'flex', alignItems: 'center',
              }}
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
