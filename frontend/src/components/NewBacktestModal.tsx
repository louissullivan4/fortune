import { useEffect, useState } from 'react'
import { X, Play, AlertTriangle } from 'lucide-react'
import { api, type Config, type BacktestConfig } from '../api/client'
import { pushToast } from './Toasts'
import { useMarketFilter } from '../hooks/useMarketFilter'
import { MARKET_CODES, getMarketSpec } from '../markets/registry'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  prefill?: Partial<BacktestConfig>
  onClose: () => void
  onCreated: () => void
}

const COLOR_RED = '#dc2626'

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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
}

function NumField({
  label,
  value,
  step,
  min,
  max,
  onChange,
  suffix,
  hint,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  onChange: (v: number) => void
  suffix?: string
  hint?: string
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...inputStyle, paddingRight: suffix ? 28 : 8 }}
        />
        {suffix && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: 'var(--color-text-muted)',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  )
}

export default function NewBacktestModal({ prefill, onClose, onCreated }: Props) {
  const { market: filterMarket } = useMarketFilter()
  const [config, setConfig] = useState<Config | null>(null)
  const [market, setMarket] = useState<string>(prefill?.market ?? filterMarket ?? 'NYSE')
  const [name, setName] = useState(prefill?.name ?? `Backtest ${todayStr()}`)
  const [startDate, setStartDate] = useState(prefill?.startDate ?? daysAgoStr(30))
  const [endDate, setEndDate] = useState(prefill?.endDate ?? todayStr())
  const [initialCash, setInitialCash] = useState(prefill?.initialCash ?? 100)
  const [tradeUniverse, setTradeUniverse] = useState<string>(
    (prefill?.tradeUniverse ?? []).join(', ')
  )
  const [maxBudgetEur, setMaxBudgetEur] = useState(prefill?.maxBudgetEur ?? 100)
  const [maxPositionPct, setMaxPositionPct] = useState(prefill?.maxPositionPct ?? 0.25)
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(prefill?.dailyLossLimitPct ?? 0.1)
  const [stopLossPct, setStopLossPct] = useState(prefill?.stopLossPct ?? 0.05)
  const [takeProfitPct, setTakeProfitPct] = useState(prefill?.takeProfitPct ?? 0.015)
  const [stagnantExitEnabled, setStagnantExitEnabled] = useState(
    prefill?.stagnantExitEnabled ?? true
  )
  const [stagnantTimeMinutes, setStagnantTimeMinutes] = useState(
    prefill?.stagnantTimeMinutes ?? 120
  )
  const [stagnantRangePct, setStagnantRangePct] = useState(prefill?.stagnantRangePct ?? 0.012)
  const [softStopEnabled, setSoftStopEnabled] = useState(prefill?.softStopEnabled ?? true)
  const [softStopHoldMinutes, setSoftStopHoldMinutes] = useState(
    prefill?.softStopHoldMinutes ?? 1440
  )
  const [softStopDrawdownPct, setSoftStopDrawdownPct] = useState(
    prefill?.softStopDrawdownPct ?? 0.05
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Only fetch when no prefill — rerun already has the full config
    if (prefill) return
    api.config
      .get(market)
      .then((c) => {
        setConfig(c)
        setTradeUniverse(c.tradeUniverse.join(', '))
        setMaxBudgetEur(c.maxBudgetEur)
        setMaxPositionPct(c.maxPositionPct)
        setDailyLossLimitPct(c.dailyLossLimitPct)
        setStopLossPct(c.stopLossPct)
        setTakeProfitPct(c.takeProfitPct)
        setStagnantExitEnabled(c.stagnantExitEnabled)
        setStagnantTimeMinutes(c.stagnantTimeMinutes)
        setStagnantRangePct(c.stagnantRangePct)
        setSoftStopEnabled(c.softStopEnabled)
        setSoftStopHoldMinutes(c.softStopHoldMinutes)
        setSoftStopDrawdownPct(c.softStopDrawdownPct)
        setInitialCash(c.maxBudgetEur)
      })
      .catch(() => {})
  }, [prefill, market])

  const tradeUniverseList = tradeUniverse
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)

  const spanDays =
    startDate && endDate
      ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000)
      : 0

  const dateError =
    startDate && endDate && new Date(startDate) > new Date(endDate)
      ? 'Start date must be on or before end date'
      : spanDays > 730
        ? `Range is ${spanDays} days — max 730 (Yahoo hourly limit)`
        : null

  const hourlyWarning =
    spanDays > 60
      ? `Yahoo's free hourly data is reliable for ~60 days. ${spanDays}d may have gaps.`
      : null

  const fieldsValid =
    !!name.trim() &&
    tradeUniverseList.length > 0 &&
    initialCash >= 10 &&
    maxBudgetEur > 0 &&
    !dateError

  async function handleRun() {
    if (!fieldsValid) return
    setSubmitting(true)
    try {
      const body: BacktestConfig = {
        name: name.trim(),
        startDate,
        endDate,
        initialCash,
        tradeUniverse: tradeUniverseList,
        tradeIntervalMs: prefill?.tradeIntervalMs ?? config?.tradeIntervalMs ?? 900_000,
        maxBudgetEur,
        maxPositionPct,
        dailyLossLimitPct,
        stopLossPct,
        takeProfitPct,
        stagnantExitEnabled,
        stagnantTimeMinutes,
        stagnantRangePct,
        softStopEnabled,
        softStopHoldMinutes,
        softStopDrawdownPct,
        autoStartOnRestart: false,
        market,
      }
      await api.backtests.create(body)
      pushToast('Backtest queued — results will appear shortly', 'info')
      onCreated()
      onClose()
    } catch (err) {
      pushToast((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
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
        overflow: 'auto',
        padding: 16,
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
          width: 560,
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
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
          <span style={{ fontSize: 14, fontWeight: 500 }}>New backtest</span>
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

        <div
          style={{
            padding: 16,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div>
            <label style={labelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="Q1 2026 sweep"
            />
          </div>

          <div>
            <label style={labelStyle}>Market</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {MARKET_CODES.map((code) => {
                let label = code
                try {
                  label = getMarketSpec(code).displayName
                } catch {
                  /* unknown */
                }
                const selected = market === code
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setMarket(code)}
                    style={{
                      flex: 1,
                      height: 32,
                      borderRadius: 4,
                      border: `0.5px solid ${
                        selected ? 'var(--color-accent)' : 'var(--color-border)'
                      }`,
                      background: selected ? 'var(--color-bg-raised)' : 'transparent',
                      color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      fontSize: 13,
                      fontWeight: selected ? 500 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
              One backtest = one market. Run a separate backtest per market to compare.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Start date</label>
              <input
                type="date"
                value={startDate}
                max={endDate || todayStr()}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>End date</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayStr()}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          {dateError && <div style={{ fontSize: 12, color: COLOR_RED }}>{dateError}</div>}
          {hourlyWarning && !dateError && (
            <div
              style={{
                fontSize: 11,
                color: '#ca8a04',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertTriangle size={11} />
              {hourlyWarning}
            </div>
          )}

          <NumField
            label="Initial cash"
            value={initialCash}
            step={10}
            min={10}
            onChange={setInitialCash}
            suffix="€"
            hint="Starting EUR balance for the simulated portfolio"
          />

          <div>
            <label style={labelStyle}>Trade universe</label>
            <input
              value={tradeUniverse}
              onChange={(e) => setTradeUniverse(e.target.value)}
              style={inputStyle}
              placeholder="AAPL, MSFT, GOOGL"
            />
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {tradeUniverseList.length} ticker{tradeUniverseList.length === 1 ? '' : 's'} (comma-
              or space-separated)
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <NumField
              label="Max budget"
              value={maxBudgetEur}
              step={10}
              min={1}
              onChange={setMaxBudgetEur}
              suffix="€"
            />
            <NumField
              label="Max position size"
              value={maxPositionPct}
              step={0.05}
              min={0.05}
              max={1}
              onChange={setMaxPositionPct}
              suffix="frac"
              hint={`${(maxPositionPct * 100).toFixed(0)}% of budget`}
            />
            <NumField
              label="Stop-loss"
              value={stopLossPct}
              step={0.005}
              min={0.005}
              max={0.5}
              onChange={setStopLossPct}
              suffix="frac"
              hint={`${(stopLossPct * 100).toFixed(1)}%`}
            />
            <NumField
              label="Take-profit"
              value={takeProfitPct}
              step={0.005}
              min={0.005}
              max={0.5}
              onChange={setTakeProfitPct}
              suffix="frac"
              hint={`${(takeProfitPct * 100).toFixed(1)}%`}
            />
            <NumField
              label="Daily loss limit"
              value={dailyLossLimitPct}
              step={0.01}
              min={0.01}
              max={1}
              onChange={setDailyLossLimitPct}
              suffix="frac"
              hint={`${(dailyLossLimitPct * 100).toFixed(0)}%`}
            />
            <NumField
              label="Stagnant time"
              value={stagnantTimeMinutes}
              step={15}
              min={15}
              onChange={setStagnantTimeMinutes}
              suffix="min"
            />
            <NumField
              label="Stagnant range"
              value={stagnantRangePct}
              step={0.001}
              min={0.001}
              max={0.1}
              onChange={setStagnantRangePct}
              suffix="frac"
              hint={`${(stagnantRangePct * 100).toFixed(1)}%`}
            />
            <div>
              <label style={labelStyle}>Stagnant rotation</label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={stagnantExitEnabled}
                  onChange={(e) => setStagnantExitEnabled(e.target.checked)}
                />
                Enabled
              </label>
            </div>
            <NumField
              label="Soft-stop hold"
              value={softStopHoldMinutes}
              step={30}
              min={15}
              onChange={setSoftStopHoldMinutes}
              suffix="min"
              hint="Min hold before soft stop can fire"
            />
            <NumField
              label="Soft-stop drawdown"
              value={softStopDrawdownPct}
              step={0.005}
              min={0.005}
              max={0.5}
              onChange={setSoftStopDrawdownPct}
              suffix="frac"
              hint={`${(softStopDrawdownPct * 100).toFixed(1)}% — exits dying trades early`}
            />
            <div>
              <label style={labelStyle}>Soft time-stop</label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={softStopEnabled}
                  onChange={(e) => setSoftStopEnabled(e.target.checked)}
                />
                Enabled
              </label>
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              padding: '8px 10px',
              borderRadius: 4,
              background: 'var(--color-bg-surface)',
              border: '0.5px solid var(--color-border)',
            }}
          >
            Backtests use the deterministic algorithm in place of Claude AI and assume
            EUR-denominated tickers (FX history is not simulated). Hourly OHLCV from Yahoo Finance.
          </div>
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderTop: '0.5px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleRun}
            disabled={!fieldsValid || submitting}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={13} />
            {submitting ? 'Queueing…' : 'Run backtest'}
          </button>
        </div>
      </div>
    </div>
  )
}
