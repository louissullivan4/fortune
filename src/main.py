import os
import yaml
import asyncio
from datetime import timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from dotenv import load_dotenv

from src.data_feed import MarketDataFeed, HistoricalDataFeed
from src.models import Tick, AnalysisRequest, AnalysisResponse
from src.execution import BrokerExecutor, HistoricalExecutor
from src.storage import MongoStorage
from src.strategies.strategy_factory import StrategyFactory
from src.utils.logger import get_logger

load_dotenv()

with open(os.getenv("CONFIG_PATH", "config.yaml")) as f:
    config = yaml.safe_load(f)

data_mode     = config.get("data_mode", "live").lower()
allowed_algos = set(config.get("algorithms", []))
active_names  = set(config.get("active_strategies", [])) or {s["name"] for s in config["strategies"]}

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

logger   = get_logger("main")
storage  = MongoStorage()
executor = HistoricalExecutor() if data_mode == "historical" else BrokerExecutor(paper=True)

strategies = []
symbols    = set()

for sconf in config["strategies"]:
    name = sconf["name"]
    if name not in active_names:
        continue
    strat = StrategyFactory.create(sconf)
    cls_name = strat.__class__.__name__
    if cls_name not in allowed_algos:
        continue
    strategies.append(strat)
    symbols.update([strat.s1, strat.s2])

if not strategies:
    raise RuntimeError("No strategies selected")

@app.on_event("startup")
async def startup():
    await storage.signals.delete_many({})
    await storage.trades.delete_many({})
    syms = list(symbols)
    if data_mode == "historical":
        h = config["historical"]
        lookback = timedelta(days=h["days"], hours=h["hours"], minutes=h["minutes"])
        app.state.feed = HistoricalDataFeed(on_tick=on_tick, lookback=lookback)
        await app.state.feed.run(syms)
    else:
        app.state.feed = MarketDataFeed(on_tick=on_tick)
        asyncio.create_task(app.state.feed.run(syms))

@app.on_event("shutdown")
async def shutdown():
    feed = getattr(app.state, "feed", None)
    if feed and hasattr(feed, "stop"):
        await feed.stop()

async def on_tick(tick: Tick):
    for strat in strategies:
        sig = strat.on_tick(tick)
        if sig:
            await storage.save_signal(sig)
            trade = executor.execute(sig)
            await storage.save_trade(trade)

@app.get("/signals")
async def get_signals():
    docs = await storage.signals.find().to_list(100)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs

@app.get("/trades")
async def get_trades():
    docs = await storage.trades.find().to_list(100)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs

@app.post("/analysis", response_model=AnalysisResponse)
async def analyze_perf(req: AnalysisRequest, strategy: Optional[str] = None):
    q = {} if not strategy else {"strategy": strategy}
    docs = await storage.signals.find(q, sort=[("timestamp", 1)]).to_list(None)
    if not docs:
        raise HTTPException(404, "No signals found")
    total_profit = n_ent = n_ex = buys = sells = wins = losses = 0
    last = None
    for sig in docs:
        qty = sig["leg1_qty"]
        if sig["signal_type"] == "ENTRY" and last is None:
            last = sig
            n_ent += 1
            buys += (sig["leg1_action"] == "BUY") + (sig["leg2_action"] == "BUY")
            sells += (sig["leg1_action"] == "SELL") + (sig["leg2_action"] == "SELL")
        elif sig["signal_type"] == "EXIT" and last:
            p1 = (last["leg1_price"] - sig["leg1_price"]) * qty
            p2 = (sig["leg2_price"] - last["leg2_price"]) * qty
            pnl = p1 + p2
            total_profit += pnl
            n_ex += 1
            buys += (sig["leg1_action"] == "BUY") + (sig["leg2_action"] == "BUY")
            sells += (sig["leg1_action"] == "SELL") + (sig["leg2_action"] == "SELL")
            if pnl >= 0:
                wins += 1
            else:
                losses += 1
            last = None
    return AnalysisResponse(
        initial_capital=req.initial_capital,
        total_profit=round(total_profit, 2),
        return_pct=round((total_profit / req.initial_capital) * 100, 2),
        n_trades=n_ex,
        n_entries=n_ent,
        n_exits=n_ex,
        total_buy_actions=buys,
        total_sell_actions=sells,
        winning_trades=wins,
        losing_trades=losses,
    )
