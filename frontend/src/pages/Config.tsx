import { useEffect, useRef, useState } from 'react'
import { X, Plus, Search, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { api, type Config, type Instrument } from '../api/client'
import { pushToast } from '../components/Toasts'

type TimeUnit = 'seconds' | 'minutes' | 'hours'
type Tab = 'universe' | 'settings' | 'credentials'

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

  function handleValue(raw: string) {
    onChange(unitToMs(Math.max(min ?? 0, Number(raw) || 0), unit))
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

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
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
        autoComplete="new-password"
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'universe', label: 'Trade Universe' },
  { id: 'settings', label: 'Settings' },
  { id: 'credentials', label: 'Credentials' },
]

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('universe')
  const [cfg, setCfg] = useState<Config | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)

  const [t212Mode, setT212Mode] = useState<'demo' | 'live'>('demo')
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasT212Key, setHasT212Key] = useState(false)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [t212Form, setT212Form] = useState({
    keyId: '',
    keySecret: '',
    mode: 'demo' as 'demo' | 'live',
  })
  const [savingAnthropic, setSavingAnthropic] = useState(false)
  const [savingT212, setSavingT212] = useState(false)

  const [instMeta, setInstMeta] = useState<Map<string, Instrument>>(new Map())
  const [filterQ, setFilterQ] = useState('')
  const [universePage, setUniversePage] = useState(1)
  const UNIVERSE_PAGE_SIZE = 10
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([api.config.get(), api.users.getApiKeys()])
      .then(async ([c, keys]) => {
        setCfg(c)
        setDraft(c)
        setT212Mode(keys.t212Mode as 'demo' | 'live')
        setHasAnthropicKey(keys.hasAnthropicKey)
        setHasT212Key(keys.hasT212Key)
        setT212Form((f) => ({ ...f, mode: keys.t212Mode as 'demo' | 'live' }))

        if (c.tradeUniverse.length > 0) {
          const resolved = await api.instruments.resolve(c.tradeUniverse).catch(() => ({}))
          const meta = new Map<string, Instrument>(
            Object.entries(resolved) as [string, Instrument][]
          )
          setInstMeta(meta)
        }
      })
      .catch(console.error)
  }, [])

  const configChanged = JSON.stringify(cfg) !== JSON.stringify(draft)
  const t212Changed = !!t212Form.keyId || !!t212Form.keySecret || t212Form.mode !== t212Mode

  async function saveConfig(d = draft) {
    if (!d) return
    setSaving(true)
    try {
      const updated = await api.config.update(d)
      setCfg(updated)
      setDraft(updated)
      pushToast('Settings saved', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function saveAnthropicKey() {
    if (!anthropicKey) return
    setSavingAnthropic(true)
    try {
      await api.users.updateApiKeys({ anthropicApiKey: anthropicKey })
      setHasAnthropicKey(true)
      setAnthropicKey('')
      pushToast('Anthropic key updated', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSavingAnthropic(false)
    }
  }

  async function saveT212() {
    if (!t212Changed) return
    setSavingT212(true)
    try {
      await api.users.updateApiKeys({
        t212KeyId: t212Form.keyId || undefined,
        t212KeySecret: t212Form.keySecret || undefined,
        t212Mode: t212Form.mode,
      })
      if (t212Form.keyId) setHasT212Key(true)
      setT212Mode(t212Form.mode)
      setT212Form((f) => ({ ...f, keyId: '', keySecret: '' }))
      pushToast('T212 credentials updated', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSavingT212(false)
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

  if (!draft)
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>

  const isLive = t212Form.mode === 'live'

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
      <div
        style={{
          position: 'sticky',
          top: 'var(--header-height)',
          zIndex: 10,
          background: 'var(--color-bg-page)',
          paddingBottom: 0,
        }}
      >
        <div style={{ paddingBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Settings</h1>
        </div>

        {/* Tab bar */}
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
                          <td style={{ padding: '9px 12px' }}>
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

        {/* ── Settings ───────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
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

            {/* Risk Controls */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div className="section-label">risk controls</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <Field
                      label="Sell if held for longer than"
                      hint="Position must be near break-even to trigger"
                    >
                      <DurationInput
                        ms={draft.stagnantTimeMinutes * 60_000}
                        onChange={(ms) =>
                          setDraft({ ...draft, stagnantTimeMinutes: Math.round(ms / 60_000) })
                        }
                        min={15}
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

        {/* ── Credentials ────────────────────────────────────────────────── */}
        {tab === 'credentials' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              alignItems: 'start',
            }}
          >
            {/* Anthropic */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div className="section-label">Anthropic</div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: hasAnthropicKey ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)',
                    color: hasAnthropicKey ? '#16a34a' : '#dc2626',
                  }}
                >
                  {hasAnthropicKey ? 'configured' : 'not set'}
                </span>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                Powers AI trade analysis and decision-making. Encrypted at rest with AES-256-GCM.
              </p>
              <Field
                label="API key"
                hint={hasAnthropicKey ? 'Leave blank to keep the existing key' : undefined}
              >
                <SecretInput
                  value={anthropicKey}
                  onChange={setAnthropicKey}
                  placeholder={hasAnthropicKey ? '(leave blank to keep existing)' : 'sk-ant-…'}
                />
              </Field>
              <button
                className="btn btn-primary"
                onClick={saveAnthropicKey}
                disabled={savingAnthropic || !anthropicKey}
                style={{ alignSelf: 'flex-start' }}
              >
                {savingAnthropic ? 'Saving…' : 'Update key'}
              </button>
            </div>

            {/* Trading 212 */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div className="section-label">Trading 212</div>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: hasT212Key ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)',
                    color: hasT212Key ? '#16a34a' : '#dc2626',
                  }}
                >
                  {hasT212Key ? 'configured' : 'not set'}
                </span>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                Executes trades on your T212 account. Encrypted at rest with AES-256-GCM.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Mode toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--color-bg-surface)',
                    borderRadius: 6,
                    border: '0.5px solid var(--color-border)',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-muted)',
                        letterSpacing: '0.03em',
                        marginBottom: 2,
                      }}
                    >
                      Account mode
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {isLive
                        ? 'Real money — orders execute on your live T212 account'
                        : 'Demo account — no real orders placed'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: isLive ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.12)',
                        color: isLive ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {isLive ? 'LIVE' : 'DEMO'}
                    </span>
                    <Toggle
                      value={isLive}
                      onChange={(v) => setT212Form((f) => ({ ...f, mode: v ? 'live' : 'demo' }))}
                    />
                  </div>
                </div>

                <Field
                  label="API key ID"
                  hint={hasT212Key ? 'Leave blank to keep the existing key' : undefined}
                >
                  <SecretInput
                    value={t212Form.keyId}
                    onChange={(v) => setT212Form((f) => ({ ...f, keyId: v }))}
                    placeholder={hasT212Key ? '(leave blank to keep existing)' : 'Key ID'}
                  />
                </Field>
                <Field
                  label="API key secret"
                  hint={hasT212Key ? 'Leave blank to keep the existing key' : undefined}
                >
                  <SecretInput
                    value={t212Form.keySecret}
                    onChange={(v) => setT212Form((f) => ({ ...f, keySecret: v }))}
                    placeholder={hasT212Key ? '(leave blank to keep existing)' : 'Key secret'}
                  />
                </Field>
              </div>

              <button
                className="btn btn-primary"
                onClick={saveT212}
                disabled={savingT212 || !t212Changed}
                style={{ alignSelf: 'flex-start' }}
              >
                {savingT212 ? 'Saving…' : 'Update credentials'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
