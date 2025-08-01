import os
from datetime import datetime

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import MarketOrderRequest
from dotenv import load_dotenv

from src.models import Order, Signal, Trade
from src.utils.logger import get_logger

load_dotenv()


class BrokerExecutor:
    def __init__(self, paper_mode: bool = True):
        self.logger = get_logger("execution")

        self.logger.info(f"BrokerExecutor initialized in with paper_mode: {paper_mode}")

        api_key = os.getenv("ALPACA_API_KEY")
        secret_key = os.getenv("ALPACA_SECRET_KEY")

        if not api_key or not secret_key:
            raise ValueError(
                "ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in environment variables"
            )

        if not paper_mode:
            self.logger.warning(
                "Live trading environment detected - forcing paper trading to False for safety"
            )

        self.client = TradingClient(api_key, secret_key, paper=paper_mode)

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

        self.logger.info(f"Placing order: {side_enum.name} {qty} of {symbol}")
        resp = self.client.submit_order(order_data=req)
        self.logger.info(f"Order submitted: {resp.id}")

        return Order(
            symbol=symbol,
            side=side_str.lower(),
            qty=qty,
            type="market",
            time_in_force="gtc",
            timestamp=now,
        )
