import os
import asyncio
import yaml
from datetime import timedelta
from fastapi import FastAPI
from src.data_feed import MarketDataFeed, HistoricalDataFeed
from src.execution import BrokerExecutor, HistoricalExecutor
from src.storage import MongoStorage
from src.manager import StrategyManager
from src.controllers import router as control_router
from src.strategies.strategy_factory import StrategyFactory
from src.models import Tick
from src.models import InitialCapitalRequest
from src.stats import StatsTracker

app = FastAPI()
app.include_router(control_router)

storage = MongoStorage()
mgr     = StrategyManager()

with open(os.getenv("CONFIG_PATH", "config.yaml")) as f:
    cfg = yaml.safe_load(f)

data_mode = cfg["data_mode"]

executor = (
    HistoricalExecutor()
    if data_mode == "historical"
    else BrokerExecutor(paper=True)
)

for sconf in cfg["strategies"]:
    strat = StrategyFactory.create(sconf)
    mgr.register(sconf["symbol1"], strat)
    mgr.register(sconf["symbol2"], strat)

@app.on_event("startup")
async def startup():
    await storage.clear()
    symbols = list(mgr.list().keys())

    if cfg["data_mode"] == "historical":
        h = cfg.get("timeframe", {})
        lookback = timedelta(
            days   = h.get("days",    0),
            hours  = h.get("hours",   0),
            minutes= h.get("minutes", 0)
        )
        feed = HistoricalDataFeed(on_tick=on_tick, lookback=lookback)
        app.state.feed = feed
        await feed.run(symbols)
    else:
        feed = MarketDataFeed(on_tick=on_tick)
        app.state.feed = feed
        asyncio.create_task(feed.run(symbols))

@app.on_event("shutdown")
async def shutdown():
    await app.state.feed.stop()

paused = False

async def on_tick(tick: Tick):
    if paused:
        return
    async for sig in _generate_signals(tick):
        await storage.save_signal(sig)
        trade = executor.execute(sig)
        await storage.save_trade(trade)

async def _generate_signals(tick):
    for sig in mgr.run_all(tick):
        yield sig

@app.post("/analysis")
async def get_stats(request: InitialCapitalRequest):
    stats = StatsTracker(request.initial_capital, risk_per_trade=0.02)
    snapshot = stats.snapshot()
    if snapshot["initial_capital"] == 0:
        raise HTTPException(400, "Must initialize with /stats/init first")
    return snapshot