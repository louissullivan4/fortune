import { useEffect, useRef, useState } from 'react'
import { X, Plus, Search, AlertTriangle } from 'lucide-react'
import { api, type Config, type Instrument, type UserMarketStatus } from '../api/client'
import { pushToast } from '../components/Toasts'
import { useMarketFilter } from '../hooks/useMarketFilter'
import { getMarketSpec } from '../markets/registry'

type TimeUnit = 'seconds' | 'minutes' | 'hours'
type Tab = 'universe' | 'config'

const POSITION_SIZE_MIN = 0.05
const POSITION_SIZE_MAX = 0.5
const POSITION_SIZE_STEP = 0.05

const DAILY_LOSS_MIN = 0.02
const DAILY_LOSS_MAX = 0.25
const DAILY_LOSS_STEP = 0.01

const STOP_LOSS_MIN = 0.005
const STOP_LOSS_MAX = 0.2
const STOP_LOSS_STEP = 0.005

const TAKE_PROFIT_MIN = 0.01
const TAKE_PROFIT_MAX = 0.5
const TAKE_PROFIT_STEP = 0.005

const STAGNANT_RANGE_MIN = 0.001
const STAGNANT_RANGE_MAX = 0.05
const STAGNANT_RANGE_STEP = 0.001

const STOP_LOSS_AGGRESSIVE_THRESHOLD = 0.1
const DAILY_LOSS_AGGRESSIVE_THRESHOLD = 0.15

function msToUnit(ms: number, unit: TimeUnit): number {
  if (unit === 'hours') return Math.round(ms / 3_600_000)
  if (unit === 'minutes') return Math.round(ms / 60_000)
  return Math.round(ms / 1_000)
}

function unitToMs(value: number, unit: TimeUnit): number {
  if (unit === 'hours') return value * 3_600_000
  if (unit === 'minutes') return value * 60_000
  return value * 1_000
}

function bestUnit(ms: number): TimeUnit {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return 'hours'
  if (ms >= 60_000 && ms % 60_000 === 0) return 'minutes'
  return 'seconds'
}

function pct(v: number, decimals = 1) {
  return `${(v * 100).toFixed(decimals)}%`
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{hint}</span>}
    </div>
  )
}

function SliderField({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  warning,
  onChange,
}: {
  label: string
  value: number
  displayValue: string
  min: number
  max: number
  step: number
  minLabel: string
  maxLabel: string
  warning?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            fontFamily: 'var(--font-code)',
            color: 'var(--color-text-primary)',
          }}
        >
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
      {warning && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#ca8a04' }}
        >
          <AlertTriangle size={11} />
          {warning}
        </div>
      )}
    </div>
  )
}

function DurationInput({
  ms,
  onChange,
  min,
  units = ['seconds', 'minutes', 'hours'],
}: {
  ms: number
  onChange: (ms: number) => void
  min?: number
  units?: TimeUnit[]
}) {
  const [unit, setUnit] = useState<TimeUnit>(() => bestUnit(ms))
  const value = msToUnit(ms, unit)

  // Don't clamp during typing — that swaps the input's displayed value mid-edit,
  // and subsequent keystrokes append to the clamped value (typing "45" after
  // clearing a min=15 field produced 1545). Clamp only on blur.
  function handleValue(raw: string) {
    onChange(unitToMs(Number(raw) || 0, unit))
  }
  function handleBlur(raw: string) {
    const typed = Number(raw) || 0
    const clamped = Math.max(min ?? 0, typed)
    if (clamped !== typed) onChange(unitToMs(clamped, unit))
  }
  function handleUnit(u: TimeUnit) {
    setUnit(u)
    onChange(unitToMs(value, u))
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        style={{ flex: 1 }}
        onChange={(e) => handleValue(e.target.value)}
        onBlur={(e) => handleBlur(e.target.value)}
      />
      <select
        className="input"
        value={unit}
        onChange={(e) => handleUnit(e.target.value as TimeUnit)}
        style={{ width: 'auto', minWidth: 100 }}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        background: value ? 'var(--color-accent)' : 'var(--color-bg-raised)',
        position: 'relative',
        transition: 'background 150ms ease',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: value ? '#fff' : 'var(--color-text-muted)',
          transition: 'left 150ms ease',
        }}
      />
    </button>
  )
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{hint}</span>}
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'universe', label: 'Trade Universe' },
  { id: 'config', label: 'Configuration' },
]

export default function ConfigPage() {
  const { market, setMarket } = useMarketFilter()
  const [tab, setTab] = useState<Tab>('universe')
  const [cfg, setCfg] = useState<Config | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [markets, setMarkets] = useState<UserMarketStatus[]>([])
  const [enabling, setEnabling] = useState(false)

  // Config is always per-market — never "ALL". Use the URL market, defaulting to NYSE.
  const selectedMarket = market ?? 'NYSE'

  const [instMeta, setInstMeta] = useState<Map<string, Instrument>>(new Map())
  const [filterQ, setFilterQ] = useState('')
  const [universePage, setUniversePage] = useState(1)
  const UNIVERSE_PAGE_SIZE = 10
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load enabled markets so we can render the market-tab strip.
  useEffect(() => {
    api.markets
      .list()
      .then(({ markets }) => setMarkets(markets))
      .catch(console.error)
  }, [])

  // Reload config whenever the selected market changes.
  useEffect(() => {
    api.config
      .get(selectedMarket)
      .then(async (c) => {
        setCfg(c)
        setDraft(c)
        if (c.tradeUniverse.length > 0) {
          const resolved = await api.instruments.resolve(c.tradeUniverse).catch(() => ({}))
          const meta = new Map<string, Instrument>(
            Object.entries(resolved) as [string, Instrument][]
          )
          setInstMeta(meta)
        } else {
          setInstMeta(new Map())
        }
      })
      .catch((err) => {
        // Market not enabled yet or other error — clear stale state.
        setCfg(null)
        setDraft(null)
        console.error(err)
      })
  }, [selectedMarket])

  const configChanged = JSON.stringify(cfg) !== JSON.stringify(draft)

  async function saveConfig(d = draft) {
    if (!d) return
    setSaving(true)
    try {
      const updated = await api.config.update(d, selectedMarket)
      setCfg(updated)
      setDraft(updated)
      pushToast('Configuration saved', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleEnableMarket(code: string) {
    setEnabling(true)
    try {
      await api.markets.enable(code)
      const { markets } = await api.markets.list()
      setMarkets(markets)
      setMarket(code)
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setEnabling(false)
    }
  }

  async function handleDisableMarket(code: string) {
    if (!confirm(`Disable ${code}? This stops its engine. Open positions must be closed first.`))
      return
    try {
      await api.markets.disable(code)
      const { markets } = await api.markets.list()
      setMarkets(markets)
      // Switch to another enabled market if we just disabled the current one.
      if (selectedMarket === code) {
        const first = markets.find((m) => m.enabled)
        setMarket(first ? first.code : null)
      }
    } catch (err) {
      pushToast((err as Error).message, 'error')
    }
  }

  async function searchInstruments(q: string) {
    if (q.length < 1) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await api.instruments.search(q)
      setSearchResults(res.data.slice(0, 20))
    } catch {
      /* non-critical */
    } finally {
      setSearching(false)
    }
  }

  async function addTicker(inst: Instrument) {
    if (!draft || draft.tradeUniverse.includes(inst.ticker)) return
    const updated = { ...draft, tradeUniverse: [...draft.tradeUniverse, inst.ticker].sort() }
    setDraft(updated)
    setInstMeta((prev) => new Map(prev).set(inst.ticker, inst))
    setSearchQ('')
    setSearchResults([])
    await saveConfig(updated)
  }

  async function removeTicker(ticker: string) {
    if (!draft) return
    const updated = { ...draft, tradeUniverse: draft.tradeUniverse.filter((t) => t !== ticker) }
    setDraft(updated)
    await saveConfig(updated)
  }

  // Render the market tab strip — always visible, even if the current market is
  // not yet enabled (so users have a way to enable it).
  function renderMarketTabs() {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 0 12px',
          flexWrap: 'wrap',
        }}
      >
        {markets.map((m) => {
          let label = m.code
          try {
            label = getMarketSpec(m.code).displayName
          } catch {
            /* unknown */
          }
          const isSelected = selectedMarket === m.code
          return (
            <div
              key={m.code}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                borderRadius: 6,
                overflow: 'hidden',
                border: `0.5px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: m.enabled ? 'var(--color-bg-raised)' : 'transparent',
              }}
            >
              <button
                onClick={() => (m.enabled ? setMarket(m.code) : handleEnableMarket(m.code))}
                disabled={enabling}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: isSelected ? 500 : 400,
                  color: isSelected
                    ? 'var(--color-accent)'
                    : m.enabled
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {!m.enabled && <Plus size={11} />}
                {label}
              </button>
              {m.enabled && (
                <button
                  onClick={() => handleDisableMarket(m.code)}
                  title={`Disable ${label}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderLeft: '0.5px solid var(--color-border)',
                    padding: '0 8px',
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (!draft) {
    // Selected market is not enabled — let the user enable it.
    const m = markets.find((x) => x.code === selectedMarket)
    return (
      <div>
        {renderMarketTabs()}
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0 12px' }}>
            {selectedMarket} is not enabled yet for your account.
          </p>
          {m && !m.enabled && (
            <button
              className="btn btn-primary"
              onClick={() => handleEnableMarket(selectedMarket)}
              disabled={enabling}
            >
              <Plus size={13} /> Enable {selectedMarket}
            </button>
          )}
        </div>
      </div>
    )
  }

  const filteredUniverse = draft.tradeUniverse.filter((ticker) => {
    if (!filterQ) return true
    const meta = instMeta.get(ticker)
    const q = filterQ.toLowerCase()
    return (
      ticker.toLowerCase().includes(q) ||
      (meta?.name.toLowerCase().includes(q) ?? false) ||
      (meta?.type.toLowerCase().includes(q) ?? false) ||
      (meta?.currencyCode.toLowerCase().includes(q) ?? false)
    )
  })
  const universeTotalPages = Math.ceil(filteredUniverse.length / UNIVERSE_PAGE_SIZE)
  const pagedUniverse = filteredUniverse.slice(
    (universePage - 1) * UNIVERSE_PAGE_SIZE,
    universePage * UNIVERSE_PAGE_SIZE
  )

  return (
    <div>
      {/* Sticky header */}
      <div className="page-sticky-header" style={{ paddingBottom: 0 }}>
        <div style={{ paddingBottom: 6 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Settings</h1>
        </div>

        {/* Per-market tab strip */}
        {renderMarketTabs()}

        {/* Sub-tab bar (universe / configuration) */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--color-border)' }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderBottom:
                  tab === id ? '2px solid var(--color-accent)' : '2px solid transparent',
                padding: '8px 16px',
                marginBottom: -1,
                fontSize: 13,
                fontWeight: tab === id ? 500 : 400,
                color: tab === id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                transition: 'color 120ms ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ paddingTop: 20 }}>
        {/* ── Trade Universe ─────────────────────────────────────────────── */}
        {tab === 'universe' && (
          <div>
            {/* Search / add card */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--color-text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  className="input"
                  style={{ paddingLeft: 32, width: '100%' }}
                  placeholder="Search instruments to add — ticker, name, or ISIN…"
                  autoComplete="off"
                  value={searchQ}
                  onChange={(e) => {
                    const q = e.target.value
                    setSearchQ(q)
                    if (searchDebounce.current) clearTimeout(searchDebounce.current)
                    searchDebounce.current = setTimeout(() => searchInstruments(q), 350)
                  }}
                />
              </div>

              {searching && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
                  Searching...
                </div>
              )}

              {searchResults.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    border: '0.5px solid var(--color-border)',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  {searchResults.map((inst) => {
                    const added = draft.tradeUniverse.includes(inst.ticker)
                    return (
                      <div
                        key={inst.ticker}
                        onMouseDown={() => !added && addTicker(inst)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderBottom: '0.5px solid var(--color-border)',
                          cursor: added ? 'default' : 'pointer',
                          opacity: added ? 0.45 : 1,
                          background: 'var(--color-bg-page)',
                          fontSize: 13,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-code)',
                              fontWeight: 600,
                              fontSize: 12,
                              minWidth: 72,
                            }}
                          >
                            {inst.ticker}
                          </span>
                          <span style={{ color: 'var(--color-text-secondary)' }}>{inst.name}</span>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 5px',
                              borderRadius: 3,
                              background: 'var(--color-bg-raised)',
                              color: 'var(--color-text-muted)',
                              fontFamily: 'var(--font-code)',
                            }}
                          >
                            {inst.type}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-code)',
                              fontSize: 11,
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {inst.currencyCode}
                          </span>
                          {added ? (
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                              added
                            </span>
                          ) : (
                            <Plus size={13} style={{ color: 'var(--color-accent)' }} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Universe table */}
            <div className="card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="section-label">trade universe</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '1px 7px',
                      borderRadius: 9999,
                      background: 'var(--color-bg-raised)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {draft.tradeUniverse.length}
                  </span>
                  {universeTotalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {universePage} / {universeTotalPages}
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ height: 24, padding: '0 8px', fontSize: 12 }}
                        disabled={universePage <= 1}
                        onClick={() => setUniversePage((p) => p - 1)}
                      >
                        ←
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ height: 24, padding: '0 8px', fontSize: 12 }}
                        disabled={universePage >= universeTotalPages}
                        onClick={() => setUniversePage((p) => p + 1)}
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={12}
                    style={{
                      position: 'absolute',
                      left: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--color-text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    className="input"
                    style={{ paddingLeft: 26, height: 30, fontSize: 12, width: 200 }}
                    placeholder="Filter…"
                    value={filterQ}
                    onChange={(e) => {
                      setFilterQ(e.target.value)
                      setUniversePage(1)
                    }}
                  />
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--color-border)' }}>
                    {['TICKER', 'NAME', 'TYPE', 'CCY', ''].map((h, i) => (
                      <th
                        key={i}
                        className={i === 2 || i === 3 ? 'table-col-hide-mobile' : undefined}
                        style={{
                          textAlign: i === 4 ? 'right' : 'left',
                          padding: '6px 12px',
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--color-text-muted)',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUniverse.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: '32px 12px',
                          textAlign: 'center',
                          color: 'var(--color-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {draft.tradeUniverse.length === 0
                          ? 'No instruments added. Search above to build your trade universe.'
                          : 'No results match your filter.'}
                      </td>
                    </tr>
                  ) : (
                    pagedUniverse.map((ticker) => {
                      const meta = instMeta.get(ticker)
                      return (
                        <tr
                          key={ticker}
                          style={{ borderBottom: '0.5px solid var(--color-border)' }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = 'var(--color-bg-surface)')
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                        >
                          <td
                            style={{
                              padding: '9px 12px',
                              fontFamily: 'var(--font-code)',
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {ticker}
                          </td>
                          <td
                            style={{
                              padding: '9px 12px',
                              fontSize: 13,
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {meta?.name ?? '—'}
                          </td>
                          <td className="table-col-hide-mobile" style={{ padding: '9px 12px' }}>
                            {meta?.type ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  background: 'var(--color-bg-raised)',
                                  color: 'var(--color-text-muted)',
                                  fontFamily: 'var(--font-code)',
                                }}
                              >
                                {meta.type}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            )}
                          </td>
                          <td
                            className="table-col-hide-mobile"
                            style={{
                              padding: '9px 12px',
                              fontFamily: 'var(--font-code)',
                              fontSize: 12,
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {meta?.currencyCode ?? '—'}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                            <button
                              onClick={() => removeTicker(ticker)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-text-muted)',
                                display: 'inline-flex',
                                padding: 3,
                                borderRadius: 3,
                              }}
                            >
                              <X size={13} />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Configuration ───────────────────────────────────────────────────── */}
        {tab === 'config' && (
          <div>
            <div
              className="grid-config-2col"
              style={{
                marginBottom: 12,
                alignItems: 'start',
              }}
            >
              {/* Engine */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="section-label">engine</div>
                <Field
                  label="Cycle interval"
                  hint="How often the engine runs a full analysis and decision cycle"
                >
                  <DurationInput
                    ms={draft.tradeIntervalMs}
                    onChange={(ms) => setDraft({ ...draft, tradeIntervalMs: ms })}
                    min={1}
                  />
                </Field>
                <ToggleRow
                  label="Auto-start on restart"
                  hint="Engine starts automatically when the server restarts"
                  value={draft.autoStartOnRestart}
                  onChange={(v) => setDraft({ ...draft, autoStartOnRestart: v })}
                />
              </div>

              {/* Budget & Exposure */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="section-label">budget & exposure</div>
                <Field
                  label="Budget cap (EUR)"
                  hint="Hard cap — total AI portfolio value will not exceed this amount"
                >
                  <input
                    type="number"
                    className="input"
                    value={draft.maxBudgetEur}
                    min={10}
                    step={10}
                    onChange={(e) => setDraft({ ...draft, maxBudgetEur: Number(e.target.value) })}
                  />
                </Field>
                <SliderField
                  label="Max position size"
                  value={draft.maxPositionPct}
                  displayValue={`${pct(draft.maxPositionPct)} · €${(draft.maxBudgetEur * draft.maxPositionPct).toFixed(0)}`}
                  min={POSITION_SIZE_MIN}
                  max={POSITION_SIZE_MAX}
                  step={POSITION_SIZE_STEP}
                  minLabel="5%"
                  maxLabel="50%"
                  onChange={(v) => setDraft({ ...draft, maxPositionPct: v })}
                />
              </div>
            </div>

            {/* Decision Engine */}
            <div
              className="card"
              style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="section-label">decision engine</div>
              </div>
              <Field label="Mode">
                <div style={{ display: 'flex', gap: 8, paddingBottom: 10 }}>
                  {(
                    [
                      { v: 'ai', label: 'AI', desc: 'Claude every cycle' },
                      {
                        v: 'deterministic',
                        label: 'Deterministic',
                        desc: 'Built-in rules, no AI calls',
                      },
                      {
                        v: 'ai_with_fallback',
                        label: 'AI + fallback',
                        desc: 'Claude, falls back to rules on error or budget cap',
                      },
                    ] as const
                  ).map((opt) => {
                    const active = draft.decisionMode === opt.v
                    return (
                      <button
                        key={opt.v}
                        type="button"
                        className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                          gap: 4,
                          lineHeight: 1.2,
                          height: 'auto',
                        }}
                        onClick={() => setDraft({ ...draft, decisionMode: opt.v })}
                      >
                        <span style={{ fontWeight: 600 }}>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </Field>
              {draft.decisionMode === 'ai_with_fallback' && (
                <Field
                  label="Monthly AI budget (USD)"
                  hint="When month-to-date Claude spend hits this, the bot switches to the rules engine for the rest of the month"
                >
                  <input
                    type="number"
                    className="input"
                    value={draft.aiCostBudgetMonthlyUsd}
                    min={0}
                    max={1000}
                    step={0.5}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        aiCostBudgetMonthlyUsd: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
            </div>

            {/* Risk Controls */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="section-label">risk controls</div>
              <div className="grid-risk-3col" style={{ gap: 24 }}>
                <SliderField
                  label="Stop-loss"
                  value={draft.stopLossPct}
                  displayValue={pct(draft.stopLossPct)}
                  min={STOP_LOSS_MIN}
                  max={STOP_LOSS_MAX}
                  step={STOP_LOSS_STEP}
                  minLabel="0.5%"
                  maxLabel="20%"
                  warning={
                    draft.stopLossPct > STOP_LOSS_AGGRESSIVE_THRESHOLD
                      ? `${pct(draft.stopLossPct)} stop-loss is aggressive — losses may exceed expectations`
                      : undefined
                  }
                  onChange={(v) => setDraft({ ...draft, stopLossPct: v })}
                />
                <SliderField
                  label="Take-profit"
                  value={draft.takeProfitPct}
                  displayValue={pct(draft.takeProfitPct)}
                  min={TAKE_PROFIT_MIN}
                  max={TAKE_PROFIT_MAX}
                  step={TAKE_PROFIT_STEP}
                  minLabel="1%"
                  maxLabel="50%"
                  onChange={(v) => setDraft({ ...draft, takeProfitPct: v })}
                />
                <SliderField
                  label="Daily loss limit"
                  value={draft.dailyLossLimitPct}
                  displayValue={pct(draft.dailyLossLimitPct)}
                  min={DAILY_LOSS_MIN}
                  max={DAILY_LOSS_MAX}
                  step={DAILY_LOSS_STEP}
                  minLabel="2%"
                  maxLabel="25%"
                  warning={
                    draft.dailyLossLimitPct > DAILY_LOSS_AGGRESSIVE_THRESHOLD
                      ? `${pct(draft.dailyLossLimitPct)} daily loss limit is aggressive — consider lowering it`
                      : undefined
                  }
                  onChange={(v) => setDraft({ ...draft, dailyLossLimitPct: v })}
                />
              </div>

              <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div className="section-label">staged take-profit</div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    scale out at the take-profit, ride the rest on a tightened trail
                  </span>
                </div>
                <div className="grid-config-2col">
                  <SliderField
                    label="Sell at take-profit"
                    value={draft.partialExitPct}
                    displayValue={
                      draft.partialExitPct >= 1
                        ? '100% (full close)'
                        : `${pct(draft.partialExitPct, 0)} now, ${pct(1 - draft.partialExitPct, 0)} on trail`
                    }
                    min={0.1}
                    max={1}
                    step={0.05}
                    minLabel="10%"
                    maxLabel="100%"
                    onChange={(v) => setDraft({ ...draft, partialExitPct: v })}
                  />
                  <SliderField
                    label="Trail pullback after partial"
                    value={draft.trailPullbackAfterPartialPct}
                    displayValue={pct(draft.trailPullbackAfterPartialPct, 2)}
                    min={0.001}
                    max={0.02}
                    step={0.0005}
                    minLabel="0.1%"
                    maxLabel="2%"
                    onChange={(v) => setDraft({ ...draft, trailPullbackAfterPartialPct: v })}
                  />
                </div>
              </div>

              <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: draft.stagnantExitEnabled ? 20 : 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="section-label">stagnant exit</div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      sell flat positions held past threshold
                    </span>
                  </div>
                  <Toggle
                    value={draft.stagnantExitEnabled}
                    onChange={(v) => setDraft({ ...draft, stagnantExitEnabled: v })}
                  />
                </div>
                {draft.stagnantExitEnabled && (
                  <div className="grid-config-2col">
                    <Field
                      label="Sell if held for longer than"
                      hint="Position must be near break-even to trigger"
                    >
                      <DurationInput
                        ms={draft.stagnantTimeMinutes * 60_000}
                        onChange={(ms) =>
                          setDraft({ ...draft, stagnantTimeMinutes: Math.round(ms / 60_000) })
                        }
                        min={1}
                        units={['minutes', 'hours']}
                      />
                    </Field>
                    <SliderField
                      label="Max price movement"
                      value={draft.stagnantRangePct}
                      displayValue={pct(draft.stagnantRangePct)}
                      min={STAGNANT_RANGE_MIN}
                      max={STAGNANT_RANGE_MAX}
                      step={STAGNANT_RANGE_STEP}
                      minLabel="0.1%"
                      maxLabel="5%"
                      onChange={(v) => setDraft({ ...draft, stagnantRangePct: v })}
                    />
                  </div>
                )}
              </div>

              <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: draft.softStopEnabled ? 20 : 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="section-label">soft time-stop</div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      cut dying trades that never armed the trailing stop
                    </span>
                  </div>
                  <Toggle
                    value={draft.softStopEnabled}
                    onChange={(v) => setDraft({ ...draft, softStopEnabled: v })}
                  />
                </div>
                {draft.softStopEnabled && (
                  <div className="grid-config-2col">
                    <Field
                      label="Min hold before soft-stop"
                      hint="Earlier than this, soft-stop never fires"
                    >
                      <DurationInput
                        ms={draft.softStopHoldMinutes * 60_000}
                        onChange={(ms) =>
                          setDraft({ ...draft, softStopHoldMinutes: Math.round(ms / 60_000) })
                        }
                        min={1}
                        units={['minutes', 'hours']}
                      />
                    </Field>
                    <SliderField
                      label="Drawdown threshold"
                      value={draft.softStopDrawdownPct}
                      displayValue={pct(draft.softStopDrawdownPct)}
                      min={0.005}
                      max={0.1}
                      step={0.005}
                      minLabel="0.5%"
                      maxLabel="10%"
                      onChange={(v) => setDraft({ ...draft, softStopDrawdownPct: v })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Save / Reset row */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setDraft(cfg)}
                disabled={!configChanged || saving}
              >
                Reset
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveConfig()}
                disabled={!configChanged || saving}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
