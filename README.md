# Trader

Autonomous stock trading engine - Claude-driven decisions, executed via Trading 212, with a multi-user web dashboard.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
DATABASE_URL=
JWT_SECRET=
ENCRYPTION_KEY=
```

Run migrations:

```bash
npm run migrate
```

## Running

```bash
npm run start    # API server + React frontend
npm run server   # Backend only
npm run build    # TypeScript compile
npm run test     # Test suite
```

## How it works

Each engine cycle per user:

1. Fetches portfolio snapshot (positions + free cash) from Trading 212
2. Pulls OHLCV price history for all tickers in the trade universe
3. Computes technical indicators (RSI, EMA, MACD, Bollinger Bands, Stochastic)
4. Sends signals and portfolio state to Claude, which returns structured buy/sell decisions
5. Validates decisions against risk rules (budget cap, position size, daily loss halt)
6. Places market orders via Trading 212

The engine runs on a configurable interval during market hours. Each user has their own engine instance, API keys, and configuration.

## For new users

See `GETTING_STARTED.md`.
