# Stagnant Exit Investigation

**Date:** 2026-04-16  
**Scope:** Why trades are closing on stagnant exits instead of reaching take-profit targets

---

## Summary

Stagnant exits are firing far too frequently because of three compounding problems: the stagnant range threshold (0.5%) is far below the take-profit target (1.5%), the "better opportunity" gate that should delay stagnant exits is almost always satisfied, and the trailing stop activates at the same 0.5% threshold — creating a ceiling that prevents positions from ever cleanly reaching the 1.5% take-profit.

---

## Current Configuration

| Parameter              | Value   | Location              |
| ---------------------- | ------- | --------------------- |
| `takeProfitPct`        | 1.5%    | `DEFAULT_USER_CONFIG` |
| `stopLossPct`          | 5.0%    | `DEFAULT_USER_CONFIG` |
| `stagnantTimeMinutes`  | 120 min | `DEFAULT_USER_CONFIG` |
| `stagnantRangePct`     | 0.5%    | `DEFAULT_USER_CONFIG` |
| `TRAIL_ACTIVATION_PCT` | 0.5%    | `EngineService.ts:45` |
| `TRAIL_STOP_PCT`       | 0.4%    | `EngineService.ts:46` |

---

## Finding 1: Dead Zone Between Stagnant Range and Take-Profit

**The gap:** Stagnant exits when `|pctFromEntry| < 0.5%`. Take-profit fires at `pctFromEntry >= 1.5%`. The space between 0.5% and 1.5% is a dead zone — a position in this range is neither stagnant (so the stagnant exit won't fire immediately) nor at take-profit.

However, any position that consolidates below 0.5% for 120 minutes will trigger a stagnant exit, even if it is about to break out toward the 1.5% target. The engine currently has no mechanism to distinguish between a position that is truly dead and one that is quietly consolidating before a move.

**The 3× gap problem:** The take-profit target is 3× the stagnant range. Stocks frequently consolidate for extended periods within 0.5% of entry before making a directional move. The 120-minute timer is long enough for most intraday consolidation patterns to complete — the engine exits right before the move rather than after.

---

## Finding 2: `hasBetterOpportunity` Gate Almost Never Blocks

`_checkStagnantExits` (`EngineService.ts:366`) only proceeds if there is at least one `buy` or `strong_buy` signal on a non-held ticker:

```typescript
const hasBetterOpportunity = signals.some(
  (s) => (s.signal === 'buy' || s.signal === 'strong_buy') && !heldTickers.has(s.ticker)
)
if (!hasBetterOpportunity) return 0
```

With a universe of 6+ tickers and a signal classifier that generates `buy` signals whenever bullishCount exceeds bearishCount (even by 1 point), there will almost always be at least one `buy` signal available. This gate was intended to prevent exiting a flat position when there is nowhere better to put the capital — but in practice it never blocks because the signal classifier is too permissive.

**Evidence from LESSONS.md (2026-04-13):** "89% of exits were stagnant" — the gate was not preventing these exits even before the HWM fix was applied.

---

## Finding 3: Trailing Stop and Stagnant Range Share the Same Threshold

`TRAIL_ACTIVATION_PCT = 0.5` and `stagnantRangePct = 0.005` (= 0.5%) are identical. This creates a compound trap:

- Position gains **exactly** 0.5%: trailing stop activates. It then trails 0.4% below peak, exiting at approximately +0.1% gain.
- Position gains **just under** 0.5%: HWM is just under `entry * 1.005`. The `positionRanUp` guard (`hwm > entry * (1 + stagnantRangePct)`) evaluates to false because the HWM never exceeded the threshold. Stagnant exit can still fire after 120 minutes.

Neither path leads to the 1.5% take-profit. The trailing stop exits too early if the position peaks at 0.5-1.4%, and the stagnant exit claims anything that moves less than 0.5% over 2 hours. The take-profit is structurally unreachable for any position that doesn't immediately run to 1.5%+ without fading.

---

## Finding 4: Stagnant Exit Runs Before the AI Gets a Vote

The cycle order in `_cycle()` is:

1. Hard exits (stop-loss, take-profit, trailing stop)
2. Generate signals
3. **Stagnant exits**
4. AI call (Claude)

A position trending toward take-profit is exited stagnantly before Claude has the opportunity to observe the momentum and hold the position. The AI's `hold` reasoning (which might account for a building setup) never runs for stagnant candidates.

---

## Finding 5: Stagnant Check Is a Point-in-Time Snapshot

`_checkStagnantExits` evaluates `pctFromEntry` at the instant of the cycle. It has no awareness of recent price direction. A position could be at +0.3% and trending upward — it still triggers a stagnant exit after 120 minutes because `0.3% < 0.5%`. Price momentum within the stagnant range is invisible to the exit logic.

---

## Root Cause Summary

| Root Cause                                                          | Impact                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Take-profit (1.5%) is 3× the stagnant range (0.5%) — too wide a gap | Positions consolidating before a breakout are exited stagnantly           |
| `hasBetterOpportunity` gate accepts any weak `buy` signal           | Gate almost never blocks stagnant exits in practice                       |
| Trailing stop and stagnant range both at 0.5% — shared ceiling      | Neither mechanism lets positions reach take-profit                        |
| Stagnant exit runs before AI call                                   | AI hold judgment never applied to stagnant candidates                     |
| No momentum awareness in stagnant check                             | Rising positions within the range are treated the same as truly flat ones |

---

## Proposed Improvements

### 1. Raise `stagnantRangePct` to 1.2%

Changing from 0.5% to 1.2% gives positions room to consolidate within a reasonable range without triggering an early exit. A position moving between -1.2% and +1.2% over 2 hours is genuinely flat; one moving 0-0.5% might just be building before a run to take-profit.

This also fixes the shared threshold with the trailing stop — at 1.2%, stagnant range is well above the 0.5% trailing activation, so the two exit mechanisms no longer compete for the same price territory.

**In `src/types/user.ts`:**

```typescript
stagnantRangePct: 0.012,  // was 0.005
```

---

### 2. Require `strong_buy` for the `hasBetterOpportunity` Gate

Change the gate from accepting `buy` or `strong_buy` to only `strong_buy`. This means the engine only rotates out of a stagnant position when the alternative is genuinely compelling, not merely marginally bullish.

**In `EngineService.ts:366`:**

```typescript
const hasBetterOpportunity = signals.some(
  (s) => s.signal === 'strong_buy' && !heldTickers.has(s.ticker)
)
```

---

### 3. Lower `takeProfitPct` to 0.8% or Raise It to 3%

The current 1.5% target sits in a no-man's-land: too high to be hit regularly on low-volatility large caps, but too low to justify the risk on high-volatility small caps. Two viable paths:

- **Lower to 0.8%:** More achievable per cycle. The engine takes profits frequently at a lower bar. Works well if win rate is high enough. Combine with fixing stagnant range above.
- **Raise to 3%:** Acknowledge that the engine is running daily cycles, not seconds. Accept that some positions will need more time to reach take-profit. Combine with disabling or loosening the trailing stop.

The current combination of 1.5% take-profit + 0.5% trailing activation is internally inconsistent — the trailing stop always fires before the take-profit.

---

### 4. Add a Momentum Guard to the Stagnant Check

Before closing a stagnant position, check if the current price is above the entry price AND above the price from the previous cycle (requires persisting `lastSeenPrice` per position). If the position is rising, skip the stagnant exit and let it run.

This is the highest-value change but requires storing a per-position last-seen price in the DB or in engine memory. Rough shape in `_checkStagnantExits`:

```typescript
// Skip if position is currently moving upward (trending toward take-profit)
const isTrendingUp = currentPrice > pos.entryPrice && /* currentPrice > lastCyclePrice */
if (!isStagnant || !atBreakEven || positionRanUp || isTrendingUp) continue
```

---

### 5. Reduce `stagnantTimeMinutes` to 60 for Faster Capital Recycling (Optional)

If stagnant range is raised to 1.2%, a position that is genuinely flat within ±1.2% for 60 minutes is a stronger signal of a dead trade than 120 minutes within ±0.5%. Shorter timer + wider range = fewer false positives, faster exit of truly dead positions.

This is an experiment: run with 60 minutes at 1.2% range and compare stagnant exit rate vs take-profit rate across one week.

---

## Recommended Implementation Order

1. **Immediate (config change, no code change):** Raise `stagnantRangePct` to 1.2% in `DEFAULT_USER_CONFIG`.
2. **Quick (one-line code change):** Restrict `hasBetterOpportunity` to `strong_buy` only.
3. **Calibration:** Decide between lowering take-profit to 0.8% or raising to 3% based on reviewing actual tick data from reports.
4. **Medium effort:** Add momentum guard (requires per-position last-seen price tracking).

Changes 1 and 2 together should eliminate the majority of spurious stagnant exits without any risk of data loss or system instability — both are conservative tightenings that reduce exit frequency.
