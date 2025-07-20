import os
import asyncio
from datetime import datetime, timedelta
from typing import Callable

from alpaca.data.live import StockDataStream
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame

from src.models import Tick
from src.utils.logger import get_logger
from dotenv import load_dotenv

load_dotenv()


class MarketDataFeed:
    def __init__(self, on_tick: Callable[[Tick], None]):
        self.logger = get_logger("data_feed")
        self._stream = StockDataStream(
            api_key=os.getenv("APCA_API_KEY"),
            api_secret=os.getenv("APCA_API_SECRET_KEY"),
            data_stream_url="wss://stream.data.sandbox.alpaca.markets/v2/iex",
        )
        self._on_tick = on_tick

    async def run(self, symbols: list[str]):
        for sym in symbols:
            self._stream.subscribe_quotes(sym, self._handle_quote)
            self.logger.info(f"Subscribed to QUOTES for {sym}")
        self._task = asyncio.create_task(self._stream._run_forever())
        self.logger.info("Market data stream started")

    async def _handle_quote(self, quote):
        price = quote.ask_price or quote.bid_price
        if price is None:
            return
        tick = Tick(symbol=quote.symbol, price=price, timestamp=quote.timestamp)
        await self._on_tick(tick)

    async def stop(self):
        if hasattr(self, "_task"):
            self._task.cancel()
        await self._stream.stop()
        self.logger.info("MarketDataFeed stopped")


class HistoricalDataFeed:
    def __init__(self, on_tick: Callable[[Tick], None], lookback: timedelta):
        self.logger = get_logger("data_feed.historical")
        self._client = StockHistoricalDataClient(
            api_key=os.getenv("APCA_API_KEY"),
            secret_key=os.getenv("APCA_API_SECRET_KEY"),
            use_basic_auth=True,
            sandbox=True,
        )
        self._on_tick = on_tick
        self.lookback = lookback

    async def run(self, symbols: list[str]):
        end_dt = datetime.utcnow()
        start_dt = end_dt - self.lookback
        req = StockBarsRequest(
            symbol_or_symbols=symbols,
            timeframe=TimeFrame.Minute,
            start=start_dt.isoformat(),
            end=end_dt.isoformat(),
            feed="iex",
        )
        bars = self._client.get_stock_bars(req)
        all_bars = [(sym, bar) for sym, bl in bars.data.items() for bar in bl]
        all_bars.sort(key=lambda x: x[1].timestamp)
        for sym, bar in all_bars:
            tick = Tick(symbol=sym, price=bar.close, timestamp=bar.timestamp)
            await self._on_tick(tick)
            await asyncio.sleep(0)

    async def stop(self):
        self.logger.info("HistoricalDataFeed stopped")
