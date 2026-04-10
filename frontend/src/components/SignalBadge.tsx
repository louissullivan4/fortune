import type { SignalType } from '../api/client'

const SIGNAL_CONFIG: Record<SignalType, { label: string; bg: string; color: string }> = {
  strong_buy: { label: 'STRONG BUY', bg: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  buy: { label: 'BUY', bg: 'rgba(22,163,74,0.08)', color: '#16a34a' },
  hold: { label: 'HOLD', bg: 'var(--color-bg-raised)', color: 'var(--color-text-muted)' },
  sell: { label: 'SELL', bg: 'rgba(220,38,38,0.08)', color: '#dc2626' },
  strong_sell: { label: 'STRONG SELL', bg: 'rgba(220,38,38,0.12)', color: '#dc2626' },
}

export default function SignalBadge({ signal }: { signal: SignalType }) {
  const cfg = SIGNAL_CONFIG[signal]
  return (
    <span className="badge" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}
