import { useEffect, useRef, useState } from 'react'
import { X, Plus, Search } from 'lucide-react'
import { api, type Config, type Instrument } from '../api/client'
import { pushToast } from '../components/Toasts'

type TimeUnit = 'seconds' | 'minutes' | 'hours'

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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-code)', color: 'var(--color-text-primary)' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}

function ExitRuleCard({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  minLabel,
  maxLabel,
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
  onChange: (v: number) => void
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-label">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-code)', color: 'var(--color-text-primary)', lineHeight: 1 }}>
        {displayValue}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
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
    const n = Math.max(min ?? 0, Number(raw) || 0)
    onChange(unitToMs(n, unit))
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
          <option key={u} value={u}>{u}</option>
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
      <span style={{
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: value ? '#fff' : 'var(--color-text-muted)',
        transition: 'left 150ms ease',
      }} />
    </button>
  )
}

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [t212Mode, setT212Mode] = useState<string>('demo')

  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasT212Key, setHasT212Key] = useState(false)
  const [keysForm, setKeysForm] = useState({
    anthropicApiKey: '',
    t212KeyId: '',
    t212KeySecret: '',
    t212Mode: 'demo' as 'demo' | 'live',
  })

  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([api.config.get(), api.users.getApiKeys()])
      .then(([c, keys]) => {
        setCfg(c)
        setDraft(c)
        setT212Mode(keys.t212Mode)
        setHasAnthropicKey(keys.hasAnthropicKey)
        setHasT212Key(keys.hasT212Key)
        setKeysForm((f) => ({ ...f, t212Mode: keys.t212Mode as 'demo' | 'live' }))
      })
      .catch(console.error)
  }, [])

  const configChanged = JSON.stringify(cfg) !== JSON.stringify(draft)
  const keysChanged =
    keysForm.anthropicApiKey !== '' ||
    keysForm.t212KeyId !== '' ||
    keysForm.t212KeySecret !== '' ||
    keysForm.t212Mode !== t212Mode
  const isChanged = configChanged || keysChanged

  async function saveAll() {
    if (!draft) return
    setSaving(true)
    try {
      const tasks: Promise<unknown>[] = []

      if (configChanged) {
        tasks.push(
          api.config.update(draft).then((updated) => {
            setCfg(updated)
            setDraft(updated)
          })
        )
      }

      if (keysChanged) {
        tasks.push(
          api.users
            .updateApiKeys({
              anthropicApiKey: keysForm.anthropicApiKey || undefined,
              t212KeyId: keysForm.t212KeyId || undefined,
              t212KeySecret: keysForm.t212KeySecret || undefined,
              t212Mode: keysForm.t212Mode,
            })
            .then(() => {
              if (keysForm.anthropicApiKey) setHasAnthropicKey(true)
              if (keysForm.t212KeyId) setHasT212Key(true)
              setT212Mode(keysForm.t212Mode)
              setKeysForm((f) => ({ ...f, anthropicApiKey: '', t212KeyId: '', t212KeySecret: '' }))
            })
        )
      }

      await Promise.all(tasks)
      pushToast('Config saved', 'info')
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setDraft(cfg)
    setKeysForm((f) => ({ ...f, anthropicApiKey: '', t212KeyId: '', t212KeySecret: '', t212Mode: t212Mode as 'demo' | 'live' }))
  }

  async function search(q: string) {
    if (q.length < 1) { setSearchResults([]); return }
    setSearching(true)
    try {
      const res = await api.instruments.search(q)
      setSearchResults(res.data.slice(0, 20))
    } catch {
      // non-critical
    } finally {
      setSearching(false)
    }
  }

  function addTicker(ticker: string) {
    if (!draft || draft.tradeUniverse.includes(ticker)) return
    setDraft({ ...draft, tradeUniverse: [...draft.tradeUniverse, ticker] })
    setSearchQ('')
    setSearchResults([])
  }

  function removeTicker(ticker: string) {
    if (!draft) return
    setDraft({ ...draft, tradeUniverse: draft.tradeUniverse.filter((t) => t !== ticker) })
  }

  if (!draft)
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Config</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={reset} disabled={!isChanged || saving}>
            Reset
          </button>
          <button className="btn btn-primary" onClick={saveAll} disabled={!isChanged || saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="section-label">budget & exposure</div>

          <Field label="Budget cap (EUR)" hint="Hard cap — no single order will exceed this amount">
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="section-label">engine</div>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 500,
              background: t212Mode === 'live' ? 'rgba(220,38,38,0.1)' : 'rgba(22,163,74,0.12)',
              color: t212Mode === 'live' ? '#dc2626' : '#16a34a',
            }}>
              {t212Mode}
            </span>
          </div>

          <Field label="Cycle interval" hint="How often the engine runs a full analysis and decision cycle">
            <DurationInput
              ms={draft.tradeIntervalMs}
              onChange={(ms) => setDraft({ ...draft, tradeIntervalMs: ms })}
              min={10}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <ExitRuleCard
          label="stop-loss"
          value={draft.stopLossPct}
          displayValue={pct(draft.stopLossPct)}
          min={STOP_LOSS_MIN}
          max={STOP_LOSS_MAX}
          step={STOP_LOSS_STEP}
          minLabel="0.5%"
          maxLabel="20%"
          onChange={(v) => setDraft({ ...draft, stopLossPct: v })}
        />
        <ExitRuleCard
          label="take-profit"
          value={draft.takeProfitPct}
          displayValue={pct(draft.takeProfitPct)}
          min={TAKE_PROFIT_MIN}
          max={TAKE_PROFIT_MAX}
          step={TAKE_PROFIT_STEP}
          minLabel="1%"
          maxLabel="50%"
          onChange={(v) => setDraft({ ...draft, takeProfitPct: v })}
        />
        <ExitRuleCard
          label="daily loss limit"
          value={draft.dailyLossLimitPct}
          displayValue={pct(draft.dailyLossLimitPct)}
          min={DAILY_LOSS_MIN}
          max={DAILY_LOSS_MAX}
          step={DAILY_LOSS_STEP}
          minLabel="2%"
          maxLabel="25%"
          onChange={(v) => setDraft({ ...draft, dailyLossLimitPct: v })}
        />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: draft.stagnantExitEnabled ? 20 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="section-label">stagnant exit</div>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              sell flat positions held past threshold
            </span>
          </div>
          <Toggle value={draft.stagnantExitEnabled} onChange={(v) => setDraft({ ...draft, stagnantExitEnabled: v })} />
        </div>

        {draft.stagnantExitEnabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Sell if held for longer than" hint="Position must be near break-even to trigger">
              <DurationInput
                ms={draft.stagnantTimeMinutes * 60_000}
                onChange={(ms) => setDraft({ ...draft, stagnantTimeMinutes: Math.round(ms / 60_000) })}
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

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-label" style={{ marginBottom: 16 }}>
          trade universe ({draft.tradeUniverse.length} tickers)
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {draft.tradeUniverse.map((ticker) => (
            <div
              key={ticker}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 28, padding: '0 10px 0 12px', borderRadius: 9999,
                border: '0.5px solid var(--color-border)', background: 'var(--color-bg-page)',
                fontSize: 12, fontFamily: 'var(--font-code)',
              }}
            >
              {ticker}
              <button
                onClick={() => removeTicker(ticker)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 1 }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ position: 'relative', maxWidth: 360 }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search instruments to add..."
              autoComplete="off"
              value={searchQ}
              onChange={(e) => {
                const q = e.target.value
                setSearchQ(q)
                if (searchDebounce.current) clearTimeout(searchDebounce.current)
                searchDebounce.current = setTimeout(() => search(q), 350)
              }}
            />
          </div>
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4, background: 'var(--color-bg-page)', border: '0.5px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
              {searchResults.map((inst) => (
                <div
                  key={inst.ticker}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid var(--color-border)', fontSize: 13 }}
                  onMouseDown={() => addTicker(inst.ticker)}
                >
                  <div>
                    <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>{inst.ticker}</span>
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 12 }}>{inst.name}</span>
                  </div>
                  <Plus size={13} style={{ color: 'var(--color-text-muted)' }} />
                </div>
              ))}
            </div>
          )}
          {searching && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>Searching...</div>}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="section-label">api keys</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: hasAnthropicKey ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)', color: hasAnthropicKey ? '#16a34a' : '#dc2626' }}>
              Anthropic {hasAnthropicKey ? '✓' : 'not set'}
            </span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: hasT212Key ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.1)', color: hasT212Key ? '#16a34a' : '#dc2626' }}>
              T212 {hasT212Key ? '✓' : 'not set'}
            </span>
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
          Keys are encrypted with AES-256-GCM. Leave a field blank to keep the existing key.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Anthropic API key">
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={keysForm.anthropicApiKey}
              onChange={(e) => setKeysForm((f) => ({ ...f, anthropicApiKey: e.target.value }))}
              placeholder={hasAnthropicKey ? '(leave blank to keep existing)' : 'sk-ant-…'}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="T212 API key ID">
              <input
                type="password"
                className="input"
                autoComplete="new-password"
                value={keysForm.t212KeyId}
                onChange={(e) => setKeysForm((f) => ({ ...f, t212KeyId: e.target.value }))}
                placeholder={hasT212Key ? '(leave blank to keep existing)' : 'Key ID'}
              />
            </Field>
            <Field label="T212 API key secret">
              <input
                type="password"
                className="input"
                autoComplete="new-password"
                value={keysForm.t212KeySecret}
                onChange={(e) => setKeysForm((f) => ({ ...f, t212KeySecret: e.target.value }))}
                placeholder={hasT212Key ? '(leave blank to keep existing)' : 'Key secret'}
              />
            </Field>
          </div>

          <Field label="T212 mode">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['demo', 'live'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn ${keysForm.t212Mode === m ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setKeysForm((f) => ({ ...f, t212Mode: m }))}
                  style={m === 'live' && keysForm.t212Mode === 'live' ? { background: '#dc2626', borderColor: '#dc2626' } : {}}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>
    </div>
  )
}
