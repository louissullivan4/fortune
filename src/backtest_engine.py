import asyncio
from datetime import datetime, timedelta

import numpy as np

from src.data_feed import HistoricalDataFeed
from src.models import BacktestResult, StrategyStatus
from src.storage import MongoStorage
from src.strategies.strategy_factory import StrategyFactory
from src.utils.logger import get_logger


class BacktestEngine:
    def __init__(self, storage=None):
        self.storage = storage or MongoStorage()
        self.logger = get_logger("backtest_engine")

    async def run_backtest(self, strategy_id, initial_capital, test_duration_days):
        self.logger.info(
            f"Starting backtest for strategy_id={strategy_id}, initial_capital={initial_capital}, test_duration_days={test_duration_days}"
        )

        try:
            # Get strategy from database
            strat_doc = await self.storage.get_strategy(strategy_id)
            if not strat_doc or strat_doc.status == StrategyStatus.DELETED:
                self.logger.warning(f"Strategy not found or deleted: {strategy_id}")
                raise ValueError("Strategy not found or deleted")

            # Validate strategy configuration
            cfg = strat_doc.config.copy()
            if "risk_per_trade" not in cfg:
                self.logger.warning(
                    f"Missing 'risk_per_trade' in config for strategy_id={strategy_id}"
                )
                return None

            # Create strategy instance
            risk_pct = cfg.get("risk_per_trade") / 100.0
            strat = StrategyFactory.create(cfg)

            # Run historical data feed
            lookback = timedelta(days=test_duration_days)
            q = asyncio.Queue()

            async def on_tick(t):
                q.put_nowait(t)

            await HistoricalDataFeed(on_tick=on_tick, lookback=lookback).run(
                [strat.s1, strat.s2]
            )
            q.put_nowait(None)

            # Process backtest
            equity = initial_capital
            eq_curve, trades, last = [], [], None

            while True:
                tick = await q.get()
                if tick is None:
                    break

                sig = strat.on_tick(tick)
                if sig and sig.signal_type == "ENTRY" and last is None:
                    qty = max(1, int(equity * risk_pct / sig.leg1_price))
                    last = {**sig.dict(), "leg1_qty": qty, "leg2_qty": qty}
                elif sig and sig.signal_type == "EXIT" and last:
                    p1 = (
                        (last["leg1_price"] - sig.leg1_price)
                        if last["leg1_action"] == "SELL"
                        else (sig.leg1_price - last["leg1_price"])
                    ) * last["leg1_qty"]
                    p2 = (
                        (sig.leg2_price - last["leg2_price"])
                        if last["leg2_action"] == "BUY"
                        else (last["leg2_price"] - sig.leg2_price)
                    ) * last["leg2_qty"]
                    pnl = p1 + p2
                    equity += pnl
                    trades.append(
                        {
                            "entry_time": last["timestamp"].isoformat(),
                            "exit_time": sig.timestamp.isoformat(),
                            "pnl": round(pnl, 2),
                        }
                    )
                    last = None
                eq_curve.append(
                    {
                        "timestamp": tick.timestamp.isoformat(),
                        "equity": round(equity, 2),
                    }
                )

            # Calculate metrics
            total_profit = round(equity - initial_capital, 2)
            return_pct = (
                round(total_profit / initial_capital * 100, 2)
                if initial_capital
                else 0.0
            )

            eq_vals = [p["equity"] for p in eq_curve]
            returns = np.diff(eq_vals) if len(eq_vals) > 1 else np.array([])
            sharpe = 0.0
            if returns.size > 1 and returns.std() > 0:
                sharpe = round(
                    returns.mean() / returns.std() * np.sqrt(len(returns)), 2
                )

            if eq_vals:
                cummax = np.maximum.accumulate(eq_vals)
                dd = (cummax - eq_vals) / cummax
                max_dd = round(np.max(dd) * 100, 2)
            else:
                max_dd = 0.0

            win_rate = (
                round(sum(1 for t in trades if t["pnl"] > 0) / len(trades) * 100, 2)
                if trades
                else 0.0
            )

            # Create and save result
            result = BacktestResult(
                id=None,
                strategy_id=strategy_id,
                strategy_name=strat_doc.name,
                timestamp=datetime.now(),
                initial_capital=initial_capital,
                test_duration_days=test_duration_days,
                total_profit=total_profit,
                return_pct=return_pct,
                sharpe_ratio=sharpe,
                max_drawdown=max_dd,
                win_rate=win_rate,
                total_trades=len(trades),
                equity_curve=eq_curve,
                trades=trades,
            )

            self.logger.info(f"Backtest completed for strategy_id={strategy_id}")
            await self.storage.save_backtest_result(result)
            return result

        except Exception as e:
            self.logger.exception(f"Backtest failed for strategy_id={strategy_id}: {e}")
            raise
