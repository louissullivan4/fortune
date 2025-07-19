import os
from motor.motor_asyncio import AsyncIOMotorClient
from src.models import Signal, Trade
from dotenv import load_dotenv
from src.utils.logger import get_logger
from datetime import datetime

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

    async def log_event(self, event_type: str, payload: dict):
        await self.db["events"].insert_one({"type": event_type, "payload": payload, "ts": datetime.utcnow()})

    async def compute_pnl(self):
        trades = await self.trades.find().to_list(None)
        pnl = sum((t["exit_order"]["price"] - t["entry_order"]["price"])*t["entry_order"]["qty"] 
                  for t in trades)
        return pnl

    async def clear(self):
        await self.signals.delete_many({})
        await self.trades.delete_many({})
        await self.db["events"].delete_many({})
        self.logger.info("Storage cleared")
    
    async def get_trades(self):
        return await self.trades.find().to_list(None)

    async def get_signals(self):
        return await self.signals.find().to_list(None)

    async def get_events(self):
        return await self.db["events"].find().to_list(None)
