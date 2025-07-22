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

        strat_doc = await self.storage.get_strategy(strategy_id)
        if not strat_doc or strat_doc.status == StrategyStatus.DELETED:
            self.logger.warning(f"Strategy not found or deleted: {strategy_id}")
            raise ValueError("Strategy not found or deleted")

        cfg = strat_doc.config.copy()
        if "risk_per_trade" not in cfg:
            self.logger.warning(
                f"Missing 'risk_per_trade' in config for strategy_id={strategy_id}"
            )
            return None

        strat = StrategyFactory.create(cfg)
        risk_pct = strat.risk_per_trade / initial_capital

        lookback = timedelta(days=test_duration_days)
        q = asyncio.Queue()

        async def on_tick(t):
            q.put_nowait(t)

        symbols = (
            [strat.s1, strat.s2]
            if hasattr(strat, "s1") and hasattr(strat, "s2")
            else [strat.symbol]
        )

        feed = HistoricalDataFeed(on_tick=on_tick, lookback=lookback)
        try:
            await feed.run(symbols)
        finally:
            q.put_nowait(None)

        equity = initial_capital
        eq_curve, trades, last = [], [], None

        while True:
            tick = await q.get()
            if tick is None:
                break
            strat.risk_per_trade = equity * risk_pct

            sig = strat.on_tick(tick)
            if sig and sig.signal_type == "ENTRY" and last is None:
                last = sig.dict()
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

        total_profit = round(equity - initial_capital, 2)
        return_pct = (
            round(total_profit / initial_capital * 100, 2) if initial_capital else 0.0
        )

        eq_vals = [p["equity"] for p in eq_curve]
        returns = np.diff(eq_vals) if len(eq_vals) > 1 else np.array([])
        sharpe = (
            round(returns.mean() / returns.std() * np.sqrt(len(returns)), 2)
            if returns.size > 1 and returns.std() > 0
            else 0.0
        )

        cummax = np.maximum.accumulate(eq_vals) if eq_vals else []
        max_dd = round(np.max((cummax - eq_vals) / cummax) * 100, 2) if eq_vals else 0.0

        win_rate = (
            round(sum(1 for t in trades if t["pnl"] > 0) / len(trades) * 100, 2)
            if trades
            else 0.0
        )

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
