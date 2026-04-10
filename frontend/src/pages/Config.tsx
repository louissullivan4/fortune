import { useEffect, useState } from 'react'
import { X, Plus, Search } from 'lucide-react'
import { api, type Config, type Instrument } from '../api/client'

function msToSec(ms: number) {
  return Math.round(ms / 1000)
}
function secToMs(s: number) {
  return s * 1000
}

type IntervalUnit = 'seconds' | 'minutes'

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minutes')

  // Instrument search
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    api.config
      .get()
      .then((c) => {
        setCfg(c)
        setDraft(c)
        // Default to seconds view if interval is sub-minute
        if (c.tradeIntervalMs < 60_000) setIntervalUnit('seconds')
      })
      .catch(console.error)
  }, [])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api.config.update(draft)
      setCfg(updated)
      setDraft(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const search = async (q: string) => {
    if (q.length < 1) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await api.instruments.search(q)
      setSearchResults(res.data.slice(0, 20))
    } catch {
      // search errors are non-critical, results stay empty
    } finally {
      setSearching(false)
    }
  }

  const addTicker = (ticker: string) => {
    if (!draft || draft.tradeUniverse.includes(ticker)) return
    setDraft({ ...draft, tradeUniverse: [...draft.tradeUniverse, ticker] })
    setSearchQ('')
    setSearchResults([])
  }

  const removeTicker = (ticker: string) => {
    if (!draft) return
    setDraft({ ...draft, tradeUniverse: draft.tradeUniverse.filter((t) => t !== ticker) })
  }

  const isChanged = JSON.stringify(cfg) !== JSON.stringify(draft)

  if (!draft)
    return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Config</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 12, color: '#16a34a' }}>Saved</span>}
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
          <button
            className="btn btn-secondary"
            onClick={() => setDraft(cfg!)}
            disabled={!isChanged || saving}
          >
            Reset
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!isChanged || saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Risk parameters */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 16 }}>
            risk parameters
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Budget cap (EUR)
            </label>
            <input
              type="number"
              className="input"
              value={draft.maxBudgetEur}
              min={10}
              step={10}
              onChange={(e) => setDraft({ ...draft, maxBudgetEur: Number(e.target.value) })}
            />
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Hard cap — no order will exceed this amount
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Max position size — {(draft.maxPositionPct * 100).toFixed(0)}% of budget (€
              {(draft.maxBudgetEur * draft.maxPositionPct).toFixed(0)})
            </label>
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.05}
              value={draft.maxPositionPct}
              onChange={(e) => setDraft({ ...draft, maxPositionPct: Number(e.target.value) })}
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
              <span>5%</span>
              <span>50%</span>
            </div>
          </div>

          <div>
            <label
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Daily loss limit — {(draft.dailyLossLimitPct * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={0.02}
              max={0.25}
              step={0.01}
              value={draft.dailyLossLimitPct}
              onChange={(e) => setDraft({ ...draft, dailyLossLimitPct: Number(e.target.value) })}
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
              <span>2%</span>
              <span>25%</span>
            </div>
          </div>
        </div>

        {/* Engine parameters */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 16 }}>
            engine parameters
          </div>

          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <label style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Cycle interval
              </label>
              <div
                style={{
                  display: 'flex',
                  background: 'var(--color-bg-page)',
                  border: '0.5px solid var(--color-border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {(['seconds', 'minutes'] as IntervalUnit[]).map((unit) => (
                  <button
                    key={unit}
                    onClick={() => setIntervalUnit(unit)}
                    style={{
                      padding: '3px 10px',
                      fontSize: 11,
                      border: 'none',
                      cursor: 'pointer',
                      background: intervalUnit === unit ? 'var(--color-bg-surface)' : 'transparent',
                      color:
                        intervalUnit === unit
                          ? 'var(--color-text-primary)'
                          : 'var(--color-text-muted)',
                      borderRight: unit === 'seconds' ? '0.5px solid var(--color-border)' : 'none',
                    }}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {intervalUnit === 'seconds' ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  {[10, 30, 60, 120].map((s) => (
                    <button
                      key={s}
                      className={`btn ${draft.tradeIntervalMs === secToMs(s) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDraft({ ...draft, tradeIntervalMs: secToMs(s) })}
                      style={{ justifyContent: 'center' }}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  className="input"
                  value={msToSec(draft.tradeIntervalMs)}
                  min={10}
                  placeholder="Custom seconds"
                  onChange={(e) =>
                    setDraft({ ...draft, tradeIntervalMs: secToMs(Number(e.target.value)) })
                  }
                />
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Minimum 10 seconds
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  {[5, 10, 15, 30].map((min) => (
                    <button
                      key={min}
                      className={`btn ${draft.tradeIntervalMs === secToMs(min * 60) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDraft({ ...draft, tradeIntervalMs: secToMs(min * 60) })}
                      style={{ justifyContent: 'center' }}
                    >
                      {min}min
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  className="input"
                  value={Math.round(msToSec(draft.tradeIntervalMs) / 60)}
                  min={1}
                  placeholder="Custom minutes"
                  onChange={(e) =>
                    setDraft({ ...draft, tradeIntervalMs: secToMs(Number(e.target.value) * 60) })
                  }
                />
              </>
            )}
          </div>

          <div
            style={{
              padding: '12px 0',
              borderTop: '0.5px solid var(--color-border)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <div>
              <div className="section-label" style={{ marginBottom: 4 }}>
                mode
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-code)',
                  color: draft.trading212Mode === 'live' ? '#dc2626' : '#16a34a',
                }}
              >
                {draft.trading212Mode}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ marginBottom: 4 }}>
                database
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-code)',
                  color: 'var(--color-text-muted)',
                }}
              >
                postgresql (postgres:18)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trade universe */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-label" style={{ marginBottom: 12 }}>
          trade universe ({draft.tradeUniverse.length} tickers)
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {draft.tradeUniverse.map((ticker) => (
            <div
              key={ticker}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 28,
                padding: '0 10px 0 12px',
                borderRadius: 9999,
                border: '0.5px solid var(--color-border)',
                background: 'var(--color-bg-surface)',
                fontSize: 12,
                fontFamily: 'var(--font-code)',
              }}
            >
              {ticker}
              <button
                onClick={() => removeTicker(ticker)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  padding: 1,
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* Instrument search */}
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-muted)',
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search instruments to add..."
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value)
                search(e.target.value)
              }}
            />
          </div>
          {searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 10,
                marginTop: 4,
                background: 'var(--color-bg-page)',
                border: '0.5px solid var(--color-border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {searchResults.map((inst) => (
                <div
                  key={inst.ticker}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '0.5px solid var(--color-border)',
                    fontSize: 13,
                  }}
                  onMouseDown={() => addTicker(inst.ticker)}
                >
                  <div>
                    <span style={{ fontFamily: 'var(--font-code)', fontWeight: 500 }}>
                      {inst.ticker}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 12 }}>
                      {inst.name}
                    </span>
                  </div>
                  <Plus size={13} style={{ color: 'var(--color-text-muted)' }} />
                </div>
              ))}
            </div>
          )}
        </div>
        {searching && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
            Searching...
          </div>
        )}
      </div>
    </div>
  )
}
