from collections import deque
from datetime import datetime

import numpy as np

from src.models import Signal, Tick
from src.strategies.base import StrategyBase
from src.utils.logger import get_logger
from src.utils.market_data import get_latest_price


class PairTrading(StrategyBase):
    def __init__(
        self,
        symbol1: str,
        symbol2: str,
        window: int,
        entry_z: float,
        exit_z: float,
        risk_per_trade: float,
    ):
        self.logger = get_logger("pair_trading")
        self.s1, self.s2 = symbol1, symbol2
        self.window, self.entry_z, self.exit_z, self.risk_per_trade = (
            window,
            entry_z,
            exit_z,
            risk_per_trade,
        )
        self.buf1 = deque(maxlen=window)
        self.buf2 = deque(maxlen=window)
        self.in_position = False
        self.logger.info(
            f"Pair trading strategy initialized: {symbol1}/{symbol2}, window={window}, entry_z={entry_z}, exit_z={exit_z}, risk_per_trade={risk_per_trade}"
        )

    def on_tick(self, tick: Tick):
        if tick.symbol == self.s1:
            self.buf1.append(tick.price)
        elif tick.symbol == self.s2:
            self.buf2.append(tick.price)

        if len(self.buf1) < self.window or len(self.buf2) < self.window:
            return None

        spread = np.array(self.buf1) - np.array(self.buf2)
        m, s = spread.mean(), spread.std()
        z = (spread[-1] - m) / s if s else 0
        now = datetime.utcnow()

        # Calculate quantities based on USD budget and latest prices
        price1 = get_latest_price(self.s1)
        price2 = get_latest_price(self.s2)
        qty1 = max(int(self.risk_per_trade // price1), 1)
        qty2 = max(int(self.risk_per_trade // price2), 1)

        if not self.in_position and z > self.entry_z:
            self.in_position = True
            self.logger.info(
                f"ENTRY signal triggered: z-score {z:.4f} > entry threshold {self.entry_z}"
            )
            return Signal(
                strategy="PairTrading",
                timestamp=now,
                signal_type="ENTRY",
                leg1_symbol=self.s1,
                leg1_action="SELL",
                leg1_qty=qty1,
                leg1_price=self.buf1[-1],
                leg2_symbol=self.s2,
                leg2_action="BUY",
                leg2_qty=qty2,
                leg2_price=self.buf2[-1],
            )
        if self.in_position and abs(z) < self.exit_z:
            self.in_position = False
            self.logger.info(
                f"EXIT signal triggered: |z-score| {abs(z):.4f} < exit threshold {self.exit_z}"
            )
            return Signal(
                strategy="PairTrading",
                timestamp=now,
                signal_type="EXIT",
                leg1_symbol=self.s1,
                leg1_action="BUY",
                leg1_qty=qty1,
                leg1_price=self.buf1[-1],
                leg2_symbol=self.s2,
                leg2_action="SELL",
                leg2_qty=qty2,
                leg2_price=self.buf2[-1],
            )
        return None
