// Standalone backtest comparison harness (no DB, no queue).
//
// Fetches 1h history once per market, then runs runBacktest() for a set of
// named config variants and prints a comparison table + exit-reason breakdown.
// Used to gather evidence for the 27/28-May performance retune. Run with:
//   npx tsx src/tools/backtest-compare.ts
//
// NOTE on fidelity: the simulator shares generateSignals()/pickDecision() with
// the live engine but reimplements exits with FIXED trail constants and does
// NOT model partial take-profits. So partialExitPct / trailPullbackAfterPartialPct
// are NOT reflected here — only SL/TP, stagnant, soft-stop and sizing are.

import { getAllHistoriesRange, type TickerHistory } from '../api/marketdata.js'
import { runBacktest } from '../backtest/simulator.js'
import type { BacktestConfig } from '../backtest/types.js'
import { DEFAULT_USER_CONFIG } from '../types/user.js'

const START = '2026-04-01'
const END = '2026-05-28'
const WARMUP_FROM = new Date('2026-03-01T00:00:00Z')
const WINDOW_END = new Date(END + 'T23:59:59Z')

// Live config snapshots (from user_market_configs, user 38cd0f45) used as each
// market's baseline. Everything not listed inherits DEFAULT_USER_CONFIG.
const NYSE_BASE: BacktestConfig = {
  ...DEFAULT_USER_CONFIG,
  name: 'NYSE baseline (live)',
  market: 'NYSE',
  startDate: START,
  endDate: END,
  initialCash: 100,
  decisionMode: 'deterministic',
  tradeUniverse: [
    'ADPT_US_EQ',
    'ARM_US_EQ',
    'COIN_US_EQ',
    'MARA_US_EQ',
    'NVDA_US_EQ',
    'ROKU_US_EQ',
    'S_US_EQ',
    'UAL_US_EQ',
  ],
  maxBudgetEur: 100,
  maxPositionPct: 0.25,
  dailyLossLimitPct: 0.25,
  stopLossPct: 0.03,
  takeProfitPct: 0.06,
  stagnantExitEnabled: true,
  stagnantTimeMinutes: 4320,
  stagnantRangePct: 0.02,
  softStopEnabled: true,
  softStopHoldMinutes: 6000,
  softStopDrawdownPct: 0.04,
  partialExitPct: 0.5,
  trailPullbackAfterPartialPct: 0.015,
  slippageBps: 15,
  fxRoundTripPct: 0.003,
}

const XETRA_BASE: BacktestConfig = {
  ...NYSE_BASE,
  name: 'XETRA baseline (live)',
  market: 'XETRA',
  tradeUniverse: ['AIXAd_EQ', 'EVTd_EQ', 'IFXd_EQ', 'LHAd_EQ', 'NEMd_EQ', 'TMVd_EQ'],
  maxPositionPct: 0.15,
  dailyLossLimitPct: 0.12,
  stagnantTimeMinutes: 2880,
  slippageBps: 25,
  fxRoundTripPct: 0,
}

function variants(base: BacktestConfig): BacktestConfig[] {
  return [
    base,
    { ...base, name: 'SL4/TP8', stopLossPct: 0.04, takeProfitPct: 0.08 },
    { ...base, name: 'pos 35%', maxPositionPct: 0.35 },
    { ...base, name: 'pos 40%', maxPositionPct: 0.4 },
    { ...base, name: 'pos 50%', maxPositionPct: 0.5 },
    {
      ...base,
      name: 'SL4/TP8 + pos35',
      stopLossPct: 0.04,
      takeProfitPct: 0.08,
      maxPositionPct: 0.35,
    },
    {
      ...base,
      name: 'SL4/TP8 + pos40',
      stopLossPct: 0.04,
      takeProfitPct: 0.08,
      maxPositionPct: 0.4,
    },
    {
      ...base,
      name: 'SL4/TP8 + pos50',
      stopLossPct: 0.04,
      takeProfitPct: 0.08,
      maxPositionPct: 0.5,
    },
    {
      ...base,
      name: 'SL5/TP10 + pos40',
      stopLossPct: 0.05,
      takeProfitPct: 0.1,
      maxPositionPct: 0.4,
    },
  ]
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}
function num(n: number | null, dp = 2): string {
  return n == null ? '—' : n.toFixed(dp)
}

async function runMarket(
  name: string,
  base: BacktestConfig,
  histories: Map<string, TickerHistory>
) {
  console.log(`\n${'='.repeat(110)}\n${name}  (${START} → ${END})\n${'='.repeat(110)}`)
  console.log(
    pad('variant', 32) +
      pad('final€', 10) +
      pad('return%', 9) +
      pad('pnl€', 9) +
      pad('win%', 7) +
      pad('trades', 8) +
      pad('maxDD%', 8) +
      pad('sharpe', 8) +
      'exit-reasons'
  )
  for (const cfg of variants(base)) {
    const m = await runBacktest(cfg, histories)
    const byReason = m.trades.reduce<Record<string, number>>((acc, t) => {
      acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1
      return acc
    }, {})
    const reasons = Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${r}:${n}`)
      .join(' ')
    console.log(
      pad(cfg.name, 32) +
        pad(num(m.finalValue), 10) +
        pad(num(m.totalReturnPct), 9) +
        pad(num(m.realizedPnl), 9) +
        pad(num(m.winRate == null ? null : m.winRate * 100, 1), 7) +
        pad(String(m.tradesCount), 8) +
        pad(num(m.maxDrawdownPct), 8) +
        pad(num(m.sharpe), 8) +
        reasons
    )
  }
}

async function main() {
  for (const base of [NYSE_BASE, XETRA_BASE]) {
    const histories = await getAllHistoriesRange(base.tradeUniverse, WARMUP_FROM, WINDOW_END, '1h')
    const bars = [...histories.values()].reduce((s, h) => s + h.bars.length, 0)
    console.log(`[fetch] ${base.market}: ${histories.size} tickers, ${bars} hourly bars`)
    if (bars === 0) {
      console.log(`[fetch] No data for ${base.market} — skipping`)
      continue
    }
    await runMarket(base.market, base, histories)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
