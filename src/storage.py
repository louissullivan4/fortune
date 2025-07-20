import os
from motor.motor_asyncio import AsyncIOMotorClient
from src.models import Signal, Trade, Strategy, BacktestResult
from dotenv import load_dotenv
from src.utils.logger import get_logger
from datetime import datetime
from typing import List, Optional
from bson import ObjectId

load_dotenv()


class MongoStorage:
    def __init__(self):
        self.logger = get_logger("storage")
        uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        self.client = AsyncIOMotorClient(uri)
        self.db = self.client["trading"]
        self.signals = self.db["signals"]
        self.trades = self.db["trades"]
        self.strategies = self.db["strategies"]
        self.backtest_results = self.db["backtest_results"]
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

    async def save_strategy(self, strategy: Strategy) -> str:
        strategy_dict = strategy.model_dump()
        if strategy.id and strategy.id != "":
            try:
                object_id = ObjectId(strategy.id)
                await self.strategies.replace_one({"_id": object_id}, strategy_dict)
            except:
                await self.strategies.replace_one({"_id": strategy.id}, strategy_dict)
            self.logger.info(f"Updated strategy: {strategy.name}")
        else:
            result = await self.strategies.insert_one(strategy_dict)
            strategy.id = str(result.inserted_id)
            self.logger.info(f"Created new strategy: {strategy.name}")
        return strategy.id

    async def get_strategy(self, strategy_id: str) -> Optional[Strategy]:
        try:
            object_id = ObjectId(strategy_id)
            doc = await self.strategies.find_one({"_id": object_id})
            if doc:
                doc["id"] = str(doc["_id"])
                return Strategy(**doc)
        except:
            doc = await self.strategies.find_one({"_id": strategy_id})
            if doc:
                doc["id"] = str(doc["_id"])
                return Strategy(**doc)
        return None

    async def get_strategies(self, status: Optional[str] = None) -> List[Strategy]:
        query = {}
        if status:
            query["status"] = status
        cursor = self.strategies.find(query).sort("created_at", -1)
        strategies = []
        async for doc in cursor:
            doc["id"] = str(doc["_id"])
            strategies.append(Strategy(**doc))
        return strategies

    async def delete_strategy(self, strategy_id: str) -> bool:
        try:
            object_id = ObjectId(strategy_id)
            result = await self.strategies.update_one(
                {"_id": object_id},
                {"$set": {"status": "deleted", "updated_at": datetime.utcnow()}},
            )
        except:
            result = await self.strategies.update_one(
                {"_id": strategy_id},
                {"$set": {"status": "deleted", "updated_at": datetime.utcnow()}},
            )

        if result.modified_count > 0:
            self.logger.info(f"Deleted strategy: {strategy_id}")
            return True
        return False

    async def save_backtest_result(self, result: BacktestResult) -> str:
        self.logger.info(f"[save_backtest_result] Called with result: {result}")
        try:
            result_dict = result.model_dump()
            if result.id:
                self.logger.info(f"[save_backtest_result] Updating existing result with id={result.id}")
                await self.backtest_results.replace_one({"_id": result.id}, result_dict)
            else:
                if "id" in result_dict:
                    del result_dict["id"]
                db_result = await self.backtest_results.insert_one(result_dict)
                result.id = str(db_result.inserted_id)
                self.logger.info(f"[save_backtest_result] Inserted new result with id={result.id}")
            return result.id
        except Exception as e:
            self.logger.exception(f"[save_backtest_result] Exception: {e}")
            raise

    async def get_backtest_results(self, strategy_id: str) -> List[BacktestResult]:
        self.logger.info(f"[get_backtest_results] Called with strategy_id={strategy_id}")
        try:
            strategy = await self.get_strategy(strategy_id)
            if not strategy:
                self.logger.warning(f"[get_backtest_results] Strategy not found: {strategy_id}")
                return []
            cursor = self.backtest_results.find({"strategy_id": strategy_id}).sort(
                "timestamp", -1
            )
            results = []
            async for doc in cursor:
                doc["id"] = str(doc["_id"])
                try:
                    results.append(BacktestResult(**doc))
                except Exception as e:
                    self.logger.exception(f"[get_backtest_results] Failed to parse BacktestResult: {e}, doc={doc}")
            self.logger.info(f"[get_backtest_results] Returning {len(results)} results for strategy_id={strategy_id}")
            return results
        except Exception as e:
            self.logger.exception(f"[get_backtest_results] Exception: {e}")
            raise
