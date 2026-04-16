# Getting Started

This guide walks you through setting up your account from the invitation email to running your first trading cycle.

---

## Step 1: Accept your invitation

You'll receive an email with the subject **"You have been invited to Trader"**. Click the link inside - it takes you to the account creation page. The link expires in 7 days.

> If the link has expired, ask your admin to resend the invitation.

---

## Step 2: Create your account

Fill in the required fields:

- First name and last name
- Username (unique, used to log in)
- Password (minimum 8 characters)

Everything else on the form (date of birth, address, phone) is optional and can be filled in later from your **Profile** page.

Click **Create account**. You'll be logged in automatically and taken to the dashboard.

---

## Step 3: Configure your API keys

The engine won't run until two sets of credentials are provided. Go to **Config** (the settings icon in the sidebar).

Scroll to the **API keys** section. You'll see red status badges for both keys - these turn green once set.

### Anthropic API key

The engine uses Claude AI to make trading decisions. You need an Anthropic API key.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up (Google or email). Phone verification required - use a real mobile number, not VoIP.
3. Once approved, go to **API Keys** in the left menu
4. Click **+ Create Key**, give it a name, and copy it immediately

Add credits to your account:
1. Go to **Billing** in the console
2. Select the **Build plan** (pay-as-you-go)
3. Add a payment method and purchase credits - $10–25 is plenty to start
4. Optionally enable **Auto-reload** so the balance never runs dry

Paste your key into the **Anthropic API key** field in Config.

### Trading 212 API credentials

An important note here that we are not liable for security incidents. If you share a key here and it is comprised we will notify you but
this key does have access to your entire trading 212 account. Be aware of the risk involved here.

1. Open the **Trading 212 app** (mobile or web) and log in
2. Go to **Settings** → **API (Beta)**. NOTE ON THE SETTINGS PAGE YOU CAN SWITCH TO PRACTICE MODE TO GENERATE A TEST TOKEN.
3. Select Generate API Key
4. Give the key a name, select unrestricted access and select true on all permissions

> The Public API is only available on **General Invest** and **Stocks & Shares ISA** accounts. Demo accounts are also supported for testing.

In Config, paste the Key and Secret into the **Trading 212** fields. Set the mode to **Demo** for paper trading or **Live** for real money.

All keys are encrypted at rest with AES-256-GCM and never returned in plaintext. 

---

## Step 4: Configure your trading settings

Still on the **Config** page, review these settings before starting the engine.

### Trade universe

The list of tickers the AI can trade. The default is a set of US large-caps. Add or remove tickers using the search field. The engine will only consider stocks in this list.

### Budget & exposure

| Setting | Default | What it controls |
|---|---|---|
| Max budget per order | €100 | Hard ceiling on any single order |
| Max position size | 25% | Largest share of the budget in one position |

### Engine interval

- How often the engine runs a full analysis cycle. Default is 15 minutes. Shorter intervals use more Anthropic tokens.
-  Set auto start to do if you want the bot to continue when new updates are pushed (RECOMMENDED to be set to true).

### Exit rules

| Rule | Default | Trigger |
|---|---|---|
| Stop-loss | 5% | Sell if position drops this much |
| Take-profit | 1.5% | Sell if position gains this much |
| Daily loss limit | 10% | Halt all trading for the day |

### Stagnant exit (optional)

Sells positions that haven't moved within a set range over a set time period. Useful for clearing stuck positions. Disabled by default.

Click **Save changes** when done.

---

## Step 5: Start the engine

Go to the **Dashboard**. The engine status shows **○ stopped**.

Click **Start**. The status changes to **● running** and shows your configured interval.

The engine will:
1. Fetch your current portfolio and free cash from Trading 212
2. Pull recent price history for all tickers in your trade universe
3. Compute technical indicators (RSI, EMA, MACD, Bollinger Bands)
4. Send the analysis to Claude, which returns structured buy/sell decisions
5. Validate each decision against your risk rules
6. Place orders via Trading 212

You can also click **Cycle** to trigger a single analysis run without starting the automated loop.

---

## Step 6: Monitor your portfolio

The dashboard updates in real time via WebSocket.

| Section | What you'll see |
|---|---|
| Stats row | Portfolio value, cost basis, free cash, unrealised P&L, realised P&L |
| AI positions | Open positions opened by the engine |
| Manual positions | Positions you hold outside the engine |
| Recent decisions | Last 10 AI decisions with reasoning and status |

Use the **Signals** page to inspect indicator strength per ticker, **Analytics** for historical performance, and **History** for a full log of past trades.

---

## Step 7: Update your profile

Go to **Profile** to fill in any personal details you skipped during signup, or to change your password.

---

## Recommendations

**Start on demo mode.** Connect a Trading 212 demo account first. All order types are available in demo, and you can validate that the engine behaves as expected before using real money.

**Start with default settings.** The defaults are conservative. Once you've observed a few cycles and feel comfortable, adjust the trade universe, budget, and exit rules to your preference.

**Watch the daily loss limit.** The engine halts all trading for the rest of the day once this threshold is hit. Set it to a level you're comfortable losing in a single session.

**Enable auto-reload on Anthropic.** Each engine cycle costs a small amount in AI tokens. Auto-reload prevents unexpected failures mid-session due to empty credit balance.

**Keep your keys private.** Never share your Trading 212 or Anthropic credentials. If they're compromised, revoke them immediately from each platform's settings and re-enter new ones in Config.
