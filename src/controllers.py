from fastapi import APIRouter, HTTPException
from src.manager import StrategyManager
from src.strategies.strategy_factory import StrategyFactory
from src.storage import MongoStorage
from src.models import Tick

router = APIRouter()
mgr = StrategyManager()
storage = MongoStorage()

@router.get("/strategies")
async def list_strategies():
    return mgr.list()

@router.post("/strategies/{symbol}/add")
async def add_strategy(symbol: str, cfg: dict):
    strat = StrategyFactory.create(cfg)
    mgr.register(symbol, strat)
    await storage.log_event("strategy_add", {"symbol": symbol, "algorithm": cfg["algorithm"]})
    return {"ok": True}

@router.post("/strategies/{symbol}/remove")
async def remove_strategy(symbol: str, algorithm: str):
    mgr.unregister(symbol, algorithm)
    await storage.log_event("strategy_remove", {"symbol": symbol, "algorithm": algorithm})
    return {"ok": True}

@router.post("/pause")
async def pause_trading():
    await storage.log_event("pause_trading", {})
    return {"status": "paused"}

@router.post("/resume")
async def resume_trading():
    await storage.log_event("resume_trading", {})
    return {"status": "running"}

@router.get("/positions")
async def dump_positions():
    return mgr.list()

@router.get("/pnl")
async def snapshot_pnl():
    pnl = await storage.compute_pnl()
    return {"pnl": pnl}
