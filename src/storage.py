import os
from motor.motor_asyncio import AsyncIOMotorClient
from src.models import Signal, Trade
from dotenv import load_dotenv
from src.utils.logger import get_logger

load_dotenv()


class MongoStorage:
    def __init__(self):
        self.logger = get_logger("storage")
        uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        self.client = AsyncIOMotorClient(uri)
        self.db = self.client["trading"]
        self.signals = self.db["signals"]
        self.trades = self.db["trades"]
        self.logger.info(f"MongoDB storage initialized with URI: {uri}")
        self.logger.debug("Connected to trading database")

    async def save_signal(self, sig: Signal):
        self.logger.debug(
            f"Saving signal: {sig.signal_type} for {sig.leg1_symbol}/{sig.leg2_symbol}"
        )
        await self.signals.insert_one(sig.dict())
        self.logger.debug("Signal saved successfully")

    async def save_trade(self, trade: Trade):
        self.logger.debug(f"Saving trade for signal: {trade.signal.signal_type}")
        await self.trades.insert_one(trade.dict())
        self.logger.debug("Trade saved successfully")
