import asyncio
import json
import os
from datetime import datetime, timedelta
from typing import Callable

from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.live import StockDataStream
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame
from dotenv import load_dotenv

from src.models import Tick
from src.utils.logger import get_logger

load_dotenv()


class MarketDataFeed:
    def __init__(self, on_tick: Callable[[Tick], None]):
        self.logger = get_logger("data_feed")

        api_key = os.getenv("ALPACA_API_KEY")
        secret_key = os.getenv("ALPACA_SECRET_KEY")

        if not api_key or not secret_key:
            raise ValueError(
                "ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in environment variables"
            )

        use_test = True
        # use_test = os.getenv("ALPACA_USE_TEST", "true").lower() == "true"
        self.logger.info(f"use_test: {use_test}")

        if use_test:
            url_override = "wss://stream.data.alpaca.markets/v2/test"
            self.logger.info("Using Alpaca test data stream")
        else:
            url_override = "wss://stream.data.alpaca.markets/v2/iex"
            self.logger.info("Using Alpaca live data stream")

        self._stream = StockDataStream(
            api_key=api_key,
            secret_key=secret_key,
            url_override=url_override,
        )
        self._on_tick = on_tick

    async def run(self, symbols: list[str]):
        self._stream.subscribe_quotes(self._handle_quote, *symbols)
        self.logger.info(f"Subscribed to QUOTES for {symbols}")
        self._task = asyncio.create_task(self._stream._run_forever())
        self.logger.info("Market data stream started")

    async def _handle_quote(self, quote):
        try:
            price = quote.ask_price or quote.bid_price
            if price is None:
                return
            tick = Tick(symbol=quote.symbol, price=price, timestamp=quote.timestamp)
            await self._on_tick(tick)

            await self._broadcast_to_websocket_clients(quote)

        except Exception as e:
            self.logger.error(f"Error in _handle_quote: {e}")

    async def _broadcast_to_websocket_clients(self, quote):
        """Broadcast quote data to connected WebSocket clients"""
        try:
            from src.routes.live_trading import live_feed_clients

            if live_feed_clients:
                quote_data = {
                    "T": "q",
                    "S": quote.symbol,
                    "symbol": quote.symbol,
                    "bp": quote.bid_price,
                    "bs": quote.bid_size,
                    "ap": quote.ask_price,
                    "as": quote.ask_size,
                    "t": quote.timestamp.isoformat() if quote.timestamp else None,
                    "timestamp": quote.timestamp.isoformat()
                    if quote.timestamp
                    else None,
                }

                data = {"type": "quote", "data": quote_data}

                for ws in list(live_feed_clients):
                    try:
                        await ws.send_text(json.dumps(data))
                    except Exception as e:
                        self.logger.error(f"Error sending to WebSocket client: {e}")
                        pass
        except Exception as e:
            self.logger.debug(f"Error broadcasting to WebSocket clients: {e}")

    async def stop(self):
        """Stop the market data feed with improved timeout handling and retry logic"""
        try:
            self.logger.info("Stopping MarketDataFeed...")

            # Cancel the main task first
            if hasattr(self, "_task") and not self._task.done():
                self._task.cancel()
                try:
                    await asyncio.wait_for(self._task, timeout=5.0)
                except asyncio.TimeoutError:
                    self.logger.warning("Task cancellation timed out, forcing stop")
                except asyncio.CancelledError:
                    self.logger.info("Task cancelled successfully")

            # Stop the Alpaca stream with extended timeout and retry logic
            if (
                self._stream
                and hasattr(self._stream, "_loop")
                and self._stream._loop is not None
            ):
                try:
                    # First attempt with extended timeout
                    self.logger.info("Attempting to stop Alpaca stream...")
                    await asyncio.wait_for(self._stream.stop(), timeout=15.0)
                    self.logger.info("Alpaca stream stopped successfully")
                except asyncio.TimeoutError:
                    self.logger.warning(
                        "First stop attempt timed out, trying alternative method..."
                    )
                    try:
                        # Alternative: try to close the WebSocket directly
                        if hasattr(self._stream, "_ws") and self._stream._ws:
                            await asyncio.wait_for(
                                self._stream._ws.close(), timeout=5.0
                            )
                            self.logger.info("WebSocket closed via alternative method")
                        else:
                            self.logger.warning("No WebSocket found to close")
                    except Exception as e:
                        self.logger.warning(f"Alternative stop method failed: {e}")
                except Exception as e:
                    self.logger.warning(f"Error stopping Alpaca stream: {e}")
                    # Don't let stream stop errors prevent the overall stop
            else:
                self.logger.info("No active stream to stop")

            self.logger.info("MarketDataFeed stopped successfully")

        except Exception as e:
            self.logger.error(f"Error in MarketDataFeed stop: {e}")
            # Don't raise the exception - we want to stop gracefully even if there are errors
        finally:
            # Clean up any remaining references
            if hasattr(self, "_task"):
                delattr(self, "_task")
            self.logger.info("MarketDataFeed cleanup completed")


class HistoricalDataFeed:
    def __init__(self, on_tick: Callable[[Tick], None], lookback: timedelta):
        self.logger = get_logger("data_feed.historical")

        # Get API credentials from environment variables
        api_key = os.getenv("ALPACA_API_KEY")
        secret_key = os.getenv("ALPACA_SECRET_KEY")

        if not api_key or not secret_key:
            raise ValueError(
                "ALPACA_API_KEY and ALPACA_SECRET_KEY must be set in environment variables"
            )

        self._client = StockHistoricalDataClient(
            api_key=api_key,
            secret_key=secret_key,
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
