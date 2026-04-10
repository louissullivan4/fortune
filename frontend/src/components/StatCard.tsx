interface Props {
  label: string
  value: string | number | null
  sub?: string
  accent?: boolean
  positive?: boolean
  negative?: boolean
}

export default function StatCard({ label, value, sub, accent, positive, negative }: Props) {
  let valueColor = 'var(--color-text-primary)'
  if (accent) valueColor = 'var(--color-accent)'
  if (positive) valueColor = '#16a34a'
  if (negative) valueColor = '#dc2626'

  return (
    <div className="card">
      <div className="section-label" style={{ marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 500, color: valueColor, letterSpacing: '-0.02em' }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}
