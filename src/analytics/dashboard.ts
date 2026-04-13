import 'dotenv/config'
import {
  getAiPortfolioConfig,
  getAiTrades,
  getAiNetPositions,
  getRecentDecisions,
  getDailyValues,
  getAllTimeStats,
} from './journal.js'
import { Trading212Client } from '../api/trading212.js'
import { runMigrations } from '../db.js'
import { getPool } from '../db.js'
import { decrypt } from '../services/encryption.js'

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  white: '\x1b[97m',
  clear: '\x1b[2J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
}

function colored(n: number, formatted: string): string {
  if (n > 0) return `${A.green}${formatted}${A.reset}`
  if (n < 0) return `${A.red}${formatted}${A.reset}`
  return formatted
}

function eur(n: number, showSign = false): string {
  const sign = showSign && n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}€${Math.abs(n).toFixed(2)}`
}

function pad(s: string, n: number): string {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
  return s + ' '.repeat(Math.max(0, n - plain.length))
}

// ── ASCII line chart ──────────────────────────────────────────────────────────

function lineChart(
  values: number[],
  firstDate: string | undefined,
  height = 7,
  width = 52
): string {
  if (values.length === 0) return `  ${A.dim}(no data yet — run a cycle first)${A.reset}\n`

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const cols = Math.min(values.length, width)
  const data: number[] =
    cols === values.length
      ? values
      : Array.from(
          { length: cols },
          (_, i) => values[Math.round((i * (values.length - 1)) / (cols - 1))]
        )

  const grid: string[][] = Array.from({ length: height }, () => Array(cols).fill(' '))
  const yPos = (v: number) => Math.round(((v - min) / range) * (height - 1))

  data.forEach((v, x) => {
    grid[height - 1 - yPos(v)][x] = '•'
  })
  data.forEach((v, x) => {
    if (x === 0) return
    const y1 = yPos(data[x - 1])
    const y2 = yPos(v)
    const lo = Math.min(y1, y2) + 1
    const hi = Math.max(y1, y2)
    for (let y = lo; y < hi; y++) {
      if (grid[height - 1 - y][x] === ' ') grid[height - 1 - y][x] = '│'
    }
  })

  const labelW = 9
  const lines = grid.map((row, i) => {
    const val = max - (range * i) / (height - 1)
    const label = `€${val.toFixed(0)}`.padStart(labelW - 1)
    const rowColor = i === 0 ? A.green : i === height - 1 ? A.dim : ''
    return `  ${A.dim}${label}${A.reset} ${A.dim}│${A.reset}${rowColor}${row.join('')}${A.reset}`
  })

  const xAxis = ' '.repeat(labelW + 1) + `${A.dim}└${'─'.repeat(cols)}${A.reset}`
  const dates =
    data.length >= 2 && firstDate ? ' '.repeat(labelW + 2) + `${A.dim}${firstDate}${A.reset}` : ''

  return lines.join('\n') + '\n' + xAxis + (dates ? '\n' + dates : '') + '\n'
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function divider(w: number, char = '─'): string {
  return `  ${A.dim}${char.repeat(w - 4)}${A.reset}`
}

function header(title: string, w: number): string {
  const inner = ` ${title} `
  const fill = Math.max(0, w - 4 - inner.length)
  const left = Math.floor(fill / 2)
  const right = fill - left
  return `  ${A.dim}${'═'.repeat(left)}${A.reset}${A.bold}${A.white}${inner}${A.reset}${A.dim}${'═'.repeat(right)}${A.reset}`
}

function sectionTitle(title: string): string {
  return `  ${A.cyan}${A.bold}${title}${A.reset}`
}

// ── Render ────────────────────────────────────────────────────────────────────

async function render(userId: string, t212: Trading212Client): Promise<void> {
  const W = Math.min(process.stdout.columns ?? 80, 90)

  const [snapshot, dailyVals, aiCfg, netPositions, recentDecisions, allTime, aiTrades] =
    await Promise.all([
      t212.getPortfolioSnapshot(),
      getDailyValues(userId, 30),
      getAiPortfolioConfig(userId),
      getAiNetPositions(userId),
      getRecentDecisions(userId, 1),
      getAllTimeStats(userId),
      getAiTrades(userId),
    ])

  const now = new Date().toLocaleTimeString()
  const executedTrades = aiTrades.filter(
    (t) => !t.orderStatus?.startsWith('blocked') && !t.orderStatus?.startsWith('error')
  )
  const lastDecision = recentDecisions[0]

  const out: string[] = []

  out.push(A.clear)
  out.push(header(`TRADER AI DASHBOARD  [${t212.mode.toUpperCase()}]`, W))
  out.push('')

  const colW = Math.floor((W - 6) / 3)

  const portfolioLines = [
    sectionTitle('PORTFOLIO'),
    divider(colW + 4),
    `  Total    ${colored(snapshot.totalValue, eur(snapshot.totalValue))}`,
    `  Cash     ${A.white}${eur(snapshot.cash.free)}${A.reset}`,
    `  Invested ${A.white}${eur(snapshot.cash.invested)}${A.reset}`,
    `  P&L      ${colored(snapshot.totalPpl, eur(snapshot.totalPpl, true))}`,
  ]

  const aiLines = [
    sectionTitle('AI PORTFOLIO'),
    divider(colW + 4),
    aiCfg
      ? [
          `  Started  ${A.dim}${aiCfg.startedAt.slice(0, 10)}${A.reset}`,
          `  Budget   ${A.white}${eur(aiCfg.initialBudget)}${A.reset}`,
          `  Cycles   ${A.white}${allTime.totalDecisions}${A.reset}`,
          `  Trades   ${A.white}${executedTrades.length}${A.reset}`,
        ].join('\n')
      : `  ${A.dim}Not init — run: npm run performance init${A.reset}`,
  ]

  const decisionLines = [
    sectionTitle('LAST DECISION'),
    divider(colW + 4),
    lastDecision
      ? [
          `  ${A.dim}${lastDecision.timestamp.slice(0, 16)}${A.reset}`,
          `  ${lastDecision.action === 'buy' ? A.green : lastDecision.action === 'sell' ? A.red : A.yellow}${lastDecision.action.toUpperCase()}${A.reset}${lastDecision.ticker ? ` ${A.bold}${lastDecision.ticker}${A.reset}` : ''}`,
          `  ${A.dim}${lastDecision.reasoning.slice(0, colW - 2)}${A.reset}`,
          lastDecision.reasoning.length > colW - 2
            ? `  ${A.dim}${lastDecision.reasoning.slice(colW - 2, (colW - 2) * 2)}${A.reset}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : `  ${A.dim}No decisions yet${A.reset}`,
  ]

  const allCols = [portfolioLines, aiLines, decisionLines]
  const flatCols = allCols.map((col) => col.join('\n').split('\n'))
  const maxRows = Math.max(...flatCols.map((c) => c.length))

  for (let i = 0; i < maxRows; i++) {
    const parts = flatCols.map((col) => pad(col[i] ?? '', colW + 2))
    out.push(parts.join(`${A.dim}│${A.reset}`))
  }

  out.push('')
  out.push(sectionTitle('PORTFOLIO VALUE (last 30 days)'))
  out.push(divider(W))
  const chartVals = dailyVals.map((d) => d.value)
  out.push(lineChart(chartVals, dailyVals[0]?.date, 7, W - 16))

  out.push(sectionTitle('AI POSITIONS'))
  out.push(divider(W))

  if (netPositions.length === 0) {
    out.push(`  ${A.dim}No open AI positions${A.reset}`)
  } else {
    out.push(
      `  ${A.dim}${'Ticker'.padEnd(14)}${'Qty'.padEnd(8)}${'Price'.padEnd(12)}${'P&L'.padEnd(12)}Status${A.reset}`
    )
    for (const np of netPositions) {
      const live = snapshot.positions.find((p) => p.ticker === np.ticker)
      const price = live ? `${live.currentPrice.toFixed(2)}` : '—'
      const pnl = live ? colored(live.ppl, eur(live.ppl, true)) : A.dim + 'n/a' + A.reset
      const status = live ? (live.ppl >= 0 ? `${A.green}▲${A.reset}` : `${A.red}▼${A.reset}`) : ''
      out.push(
        `  ${np.ticker.padEnd(14)}${String(np.netQuantity).padEnd(8)}${price.padEnd(12)}${pad(pnl, 12)}${status}`
      )
    }
  }

  out.push('')
  out.push(divider(W, '═'))
  out.push(`  ${A.dim}[q] quit   [r] refresh   Updated: ${now}   Next auto-refresh: 30s${A.reset}`)
  out.push('')

  process.stdout.write(out.join('\n'))
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function getCliT212(): Promise<{ userId: string; t212: Trading212Client }> {
  const userId = process.env.USER_ID
  if (!userId) {
    console.error('USER_ID env var is required (set to your user_id UUID)')
    process.exit(1)
  }
  const pool = getPool()
  const res = await pool.query<{
    t212_key_id_enc: string | null
    t212_key_secret_enc: string | null
    t212_mode: string
  }>(
    'SELECT t212_key_id_enc, t212_key_secret_enc, t212_mode FROM user_api_keys WHERE user_id = $1',
    [userId]
  )
  const row = res.rows[0]
  if (!row?.t212_key_id_enc || !row?.t212_key_secret_enc) {
    console.error('No T212 API keys found for this user. Set them via the web UI.')
    process.exit(1)
  }
  const t212 = new Trading212Client(
    decrypt(row.t212_key_id_enc),
    decrypt(row.t212_key_secret_enc),
    (row.t212_mode ?? 'demo') as 'demo' | 'live'
  )
  return { userId, t212 }
}

async function main(): Promise<void> {
  await runMigrations()
  const { userId, t212 } = await getCliT212()

  process.stdout.write(A.hideCursor)

  const cleanup = () => {
    process.stdout.write(A.showCursor)
    process.stdout.write('\n')
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', async (key: Buffer) => {
      const k = key.toString()
      if (k === 'q' || k === '\x03') cleanup()
      if (k === 'r') {
        process.stdout.write(`  ${A.dim}Refreshing...${A.reset}`)
        await render(userId, t212).catch(console.error)
      }
    })
  }

  await render(userId, t212).catch(console.error)

  setInterval(async () => {
    await render(userId, t212).catch(console.error)
  }, 30_000)
}

main()
