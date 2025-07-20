import os
from datetime import datetime
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from src.models import Signal, Order, Trade
from src.utils.logger import get_logger


class BrokerExecutor:
    def __init__(self, paper: bool = True, simulate: bool = False):
        self.logger = get_logger("execution")
        self.simulate = simulate
        mode = "SIMULATION" if simulate else ("PAPER" if paper else "LIVE")
        self.logger.info(f"BrokerExecutor initialized in {mode} mode")
        if not simulate:
            self.client = TradingClient(
                os.getenv("APCA_API_KEY"), os.getenv("APCA_API_SECRET_KEY"), paper=paper
            )

    def execute(self, sig: Signal) -> Trade:
        self.logger.info(f"Executing signal {sig.signal_type}")
        o1 = self._place(sig.leg1_symbol, sig.leg1_action, sig.leg1_qty)
        o2 = None
        if sig.leg2_symbol:
            o2 = self._place(sig.leg2_symbol, sig.leg2_action, sig.leg2_qty)
        return Trade(signal=sig, entry_order=o1, exit_order=o2)

    def _place(self, symbol: str, side_str: str, qty: float) -> Order:
        side_enum = OrderSide.BUY if side_str.lower() == "buy" else OrderSide.SELL
        now = datetime.now()

        req = MarketOrderRequest(
            symbol=symbol, qty=qty, side=side_enum, time_in_force=TimeInForce.GTC
        )

        if not self.simulate:
            self.logger.info(f"Placing order: {side_enum.name} {qty} of {symbol}")
            resp = self.client.submit_order(order_data=req)
            self.logger.info(f"Order submitted: {resp.id}")
        else:
            self.logger.info(f"[SIM] Would place {side_enum.name} {qty} of {symbol}")

        return Order(
            symbol=symbol,
            side=side_str.lower(),
            qty=qty,
            type="market",
            time_in_force="gtc",
            timestamp=now,
        )
