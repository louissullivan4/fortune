from collections import deque
from datetime import datetime
import numpy as np
from src.models import Tick, Signal
from src.strategies.base import StrategyBase
from src.utils.logger import get_logger


class HedgedPairTrading(StrategyBase):
    def __init__(
        self,
        symbol1: str,
        symbol2: str,
        window_beta: int,
        window_z: int,
        entry_z: float,
        exit_z: float,
        qty: float,
    ):
        self.logger = get_logger("hedged_pair_trading")
        self.s1, self.s2 = symbol1, symbol2
        self.window_beta, self.window_z = window_beta, window_z
        self.entry_z, self.exit_z, self.qty = entry_z, exit_z, qty

        maxlen = max(window_beta, window_z)
        self.buf1 = deque(maxlen=maxlen)
        self.buf2 = deque(maxlen=maxlen)

        self.in_position = False
        self.logger.info(
            f"HedgedPairTrading initialized: {symbol1}/{symbol2}, "
            f"β_window={window_beta}, z_window={window_z}, "
            f"entry_z={entry_z}, exit_z={exit_z}, qty={qty}"
        )

    def on_tick(self, tick: Tick):
        if tick.symbol == self.s1:
            self.buf1.append(tick.price)
        elif tick.symbol == self.s2:
            self.buf2.append(tick.price)
        else:
            return None

        if len(self.buf1) < self.window_z or len(self.buf2) < self.window_z:
            return None

        if len(self.buf2) >= self.window_beta:
            y = np.array(list(self.buf1)[-self.window_beta :])
            x = np.array(list(self.buf2)[-self.window_beta :])
            β = np.polyfit(x, y, 1)[0]
        else:
            β = 1.0

        p1 = np.array(list(self.buf1)[-self.window_z :])
        p2 = np.array(list(self.buf2)[-self.window_z :])
        spread = p1 - β * p2

        m, s = spread.mean(), spread.std()
        z = (spread[-1] - m) / s if s else 0.0
        now = datetime.utcnow()

        self.logger.debug(
            f"Hedged spread: β={β:.4f}, mean={m:.4f}, std={s:.4f}, z={z:.4f}, in_pos={self.in_position}"
        )

        if not self.in_position and z > self.entry_z:
            self.in_position = True
            self.logger.info(f"ENTRY: z={z:.4f} > {self.entry_z}")
            return Signal(
                strategy="HedgedPairTrading",
                timestamp=now,
                signal_type="ENTRY",
                leg1_symbol=self.s1,
                leg1_action="SELL",
                leg1_qty=self.qty,
                leg1_price=self.buf1[-1],
                leg2_symbol=self.s2,
                leg2_action="BUY",
                leg2_qty=self.qty,
                leg2_price=self.buf2[-1],
            )

        if self.in_position and abs(z) < self.exit_z:
            self.in_position = False
            self.logger.info(f"EXIT: |z|={abs(z):.4f} < {self.exit_z}")
            return Signal(
                strategy="HedgedPairTrading",
                timestamp=now,
                signal_type="EXIT",
                leg1_symbol=self.s1,
                leg1_action="BUY",
                leg1_qty=self.qty,
                leg1_price=self.buf1[-1],
                leg2_symbol=self.s2,
                leg2_action="SELL",
                leg2_qty=self.qty,
                leg2_price=self.buf2[-1],
            )

        return None
