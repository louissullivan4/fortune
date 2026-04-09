# Trader

Autonomous stock trader — Claude-driven decisions, Trading 212-executed, with a hard EUR budget cap.

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
```

Fill in `.env`:
```
ANTHROPIC_API_KEY=        # Your Anthropic API key
TRADING_212_API_KEY_ID=   # T212 API key ID (Settings → API)
TRADING_212_API_KEY_SECRET=
TRADING_212_MODE=demo     # demo or live
MAX_BUDGET_EUR=100        # Hard cap — bot won't spend more than this
```

## Running

**Start the trading loop** (runs every 15 min during market hours)
```bash
npm run dev
```

**Run a single cycle manually**
```bash
npm run cycle
```

**View performance dashboard**
```bash
npm run performance
```

**Initialise the performance tracker with a budget**
```bash
npm run performance init 100   # €100 starting budget
```

**View analytics report**
```bash
npm run report
```

**View terminal dashboard**
```bash
Im
```

## How it works

1. Fetches your T212 portfolio snapshot (positions + cash)
2. Pulls 90 days of price history from Yahoo Finance for all tickers
3. Generates technical signals (RSI, moving averages, etc.)
4. Sends signals + portfolio state to Claude, which decides buy / sell / hold
5. Validates the decision against risk rules (budget cap, position limits, daily loss halt)
6. Places a market order on T212 if approved

Market hours checked automatically — LSE (08:00–16:30 UTC) and US (14:30–21:00 UTC). No trades outside market hours.

## Risk controls

| Setting | Default | Description |
|---|---|---|
| `MAX_BUDGET_EUR` | 100 | Hard spend cap across all AI trades |
| `MAX_POSITION_PCT` | 25% | Max single position as % of budget |
| `DAILY_LOSS_LIMIT_PCT` | 10% | Halts trading if portfolio drops >10% in a day |
| `TRADE_INTERVAL_MS` | 10000 | 10 seconds between cycles |
