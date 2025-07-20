import os
import yaml
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv

from src.data_feed import MarketDataFeed
from src.models import Tick
from src.execution import BrokerExecutor
from src.storage import MongoStorage
from src.strategies.strategy_factory import StrategyFactory
from src.utils.logger import get_logger
from src.routes.strategy_management import router as strategy_router
from src.routes.emergency import router as emergency_router
from src.routes.live_trading import router as live_trading_router

load_dotenv()

with open(os.getenv("CONFIG_PATH", "config.yaml")) as f:
    config = yaml.safe_load(f)

data_mode = config.get("data_mode", "live").lower()
allowed_algos = set(config.get("algorithms", []))
active_names = set(config.get("active_strategies", [])) or {
    s["name"] for s in config["strategies"]
}

app = FastAPI()
app.state.strategy_configs = {}
app.state.strategies = {}
app.state.symbols = set()
app.state.paused = False
app.state.config = config

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = get_logger("main")
storage = MongoStorage()
executor = BrokerExecutor(paper=True)

app.state.storage = storage

for sconf in config["strategies"]:
    name = sconf["name"]
    if name not in active_names:
        continue
    strat = StrategyFactory.create(sconf)
    if strat.__class__.__name__ not in allowed_algos:
        continue

    app.state.strategy_configs[name] = sconf
    app.state.strategies[name] = strat
    app.state.symbols.update([strat.s1, strat.s2])

if not app.state.strategies:
    raise RuntimeError("No strategies selected")


@app.on_event("startup")
async def startup():
    await storage.signals.delete_many({})
    await storage.trades.delete_many({})
    if data_mode == "live":
        syms = list(app.state.symbols)
        app.state.feed = MarketDataFeed(on_tick=on_tick)
        asyncio.create_task(app.state.feed.run(syms))


@app.on_event("shutdown")
async def shutdown():
    feed = getattr(app.state, "feed", None)
    if feed and hasattr(feed, "stop"):
        await feed.stop()


async def on_tick(tick: Tick):
    if app.state.paused:
        return
    for strat in app.state.strategies.values():
        sig = strat.on_tick(tick)
        if sig:
            await storage.save_signal(sig)
            trade = executor.execute(sig)
            await storage.save_trade(trade)


app.include_router(strategy_router, prefix="/strategies")
app.include_router(emergency_router, prefix="/emergency")
app.include_router(live_trading_router, prefix="/live-trading")
