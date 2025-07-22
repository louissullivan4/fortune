from datetime import datetime
from typing import Optional
from src.strategies.base import StrategyBase
from src.models import Signal, Tick
from src.indicators.bollinger import BollingerBands
from src.utils.market_data_utils import get_latest_price


class BollingerReversionStrategy(StrategyBase):
    def __init__(
        self,
        symbol: str,
        window: int = 20,
        num_std: float = 2.0,
        risk_per_trade: float = 1000.0,
    ):
        self.symbol = symbol
        self.bb = BollingerBands(window, num_std)
        self.in_position = False
        self.risk_per_trade = risk_per_trade
        self.entry_side = None
        self.entry_price = None

    def on_tick(self, tick: Tick) -> Optional[Signal]:
        if tick.symbol != self.symbol:
            return None
        price = tick.price
        bands = self.bb.update(price)
        if bands is None:
            return None
        middle, upper, lower = bands
        now = datetime.utcnow()
        qty = max(int(self.risk_per_trade // price), 1)

        if not self.in_position:
            if price <= lower:
                self.in_position = True
                self.entry_side = "BUY"
                self.entry_price = price
                return Signal(
                    strategy="BollingerReversionStrategy",
                    timestamp=now,
                    signal_type="ENTRY",
                    leg1_symbol=self.symbol,
                    leg1_action="BUY",
                    leg1_qty=qty,
                    leg1_price=price,
                    leg2_symbol="",
                    leg2_action="BUY",
                    leg2_qty=0,
                    leg2_price=0.0,
                )
            elif price >= upper:
                self.in_position = True
                self.entry_side = "SELL"
                self.entry_price = price
                return Signal(
                    strategy="BollingerReversionStrategy",
                    timestamp=now,
                    signal_type="ENTRY",
                    leg1_symbol=self.symbol,
                    leg1_action="SELL",
                    leg1_qty=qty,
                    leg1_price=price,
                    leg2_symbol="",
                    leg2_action="SELL",
                    leg2_qty=0,
                    leg2_price=0.0,
                )
        if self.in_position:
            if self.entry_side == "BUY" and price >= middle:
                self.in_position = False
                self.entry_side = None
                self.entry_price = None
                return Signal(
                    strategy="BollingerReversionStrategy",
                    timestamp=now,
                    signal_type="EXIT",
                    leg1_symbol=self.symbol,
                    leg1_action="SELL",
                    leg1_qty=qty,
                    leg1_price=price,
                    leg2_symbol="",
                    leg2_action="SELL",
                    leg2_qty=0,
                    leg2_price=0.0,
                )
            elif self.entry_side == "SELL" and price <= middle:
                self.in_position = False
                self.entry_side = None
                self.entry_price = None
                return Signal(
                    strategy="BollingerReversionStrategy",
                    timestamp=now,
                    signal_type="EXIT",
                    leg1_symbol=self.symbol,
                    leg1_action="BUY",
                    leg1_qty=qty,
                    leg1_price=price,
                    leg2_symbol="",
                    leg2_action="BUY",
                    leg2_qty=0,
                    leg2_price=0.0,
                )
        return None
