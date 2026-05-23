import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Check } from 'lucide-react'
import { useMarketFilter } from '../hooks/useMarketFilter'
import { api, type UserMarketStatus } from '../api/client'
import { getMarketSpec } from '../markets/registry'

/**
 * Global market filter dropdown. Mounts in the header strip of Layout.
 *
 * - "All markets" clears the ?market URL param (aggregate view across markets).
 * - A specific market scopes pages to that market only.
 * - "+ Add market" is exposed for un-enabled catalog markets — clicking enables
 *   the market via PUT /api/users/me/markets/:code and selects it.
 */
export default function MarketDropdown() {
  const { market, setMarket } = useMarketFilter()
  const [open, setOpen] = useState(false)
  const [markets, setMarkets] = useState<UserMarketStatus[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    try {
      const { markets } = await api.markets.list()
      setMarkets(markets)
    } catch {
      // Endpoint may be unreachable on first paint; retry on next open.
    }
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function enableAndSelect(code: string) {
    try {
      await api.markets.enable(code)
      await refresh()
      setMarket(code)
      setOpen(false)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const enabled = markets.filter((m) => m.enabled)
  const available = markets.filter((m) => !m.enabled)
  const label = market === null ? 'All markets' : (getSpecLabel(market) ?? market)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          height: 30,
          width: '100%',
          fontSize: 13,
          background: 'var(--color-bg-raised)',
          borderRadius: 6,
        }}
      >
        <span>{label}</span>
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '100%',
            background: 'var(--color-bg-page)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 6,
            padding: 3,
            zIndex: 50,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          <DropdownItem
            label="All markets"
            selected={market === null}
            onClick={() => {
              setMarket(null)
              setOpen(false)
            }}
          />
          {enabled.length > 0 && <Divider />}
          {enabled.map((m) => (
            <DropdownItem
              key={m.code}
              label={getSpecLabel(m.code) ?? m.code}
              selected={market === m.code}
              onClick={() => {
                setMarket(m.code)
                setOpen(false)
              }}
            />
          ))}
          {available.length > 0 && <Divider />}
          {available.map((m) => (
            <DropdownItem
              key={m.code}
              label={getSpecLabel(m.code) ?? m.code}
              icon={<Plus size={12} />}
              hint="Add"
              onClick={() => void enableAndSelect(m.code)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DropdownItem({
  label,
  hint,
  selected,
  icon,
  onClick,
}: {
  label: string
  hint?: string
  selected?: boolean
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        width: '100%',
        textAlign: 'left',
        padding: '6px 8px',
        fontSize: 12,
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        color: 'var(--color-text-primary)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-surface)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')
      }
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        {label}
      </span>
      {selected ? (
        <Check size={12} style={{ opacity: 0.6 }} />
      ) : hint ? (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{hint}</span>
      ) : null}
    </button>
  )
}

function Divider() {
  return <div style={{ height: '0.5px', background: 'var(--color-border)', margin: '2px 0' }} />
}

function getSpecLabel(code: string): string | null {
  try {
    return getMarketSpec(code).displayName
  } catch {
    return null
  }
}
