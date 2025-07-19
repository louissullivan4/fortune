from pydantic import BaseModel
from datetime import datetime
from typing import Literal


class Tick(BaseModel):
    symbol: str
    price: float
    timestamp: datetime


class Signal(BaseModel):
    strategy: str
    timestamp: datetime
    signal_type: Literal["ENTRY", "EXIT"]
    leg1_symbol: str
    leg1_action: Literal["BUY", "SELL"]
    leg1_qty: float
    leg1_price: float
    leg2_symbol: str
    leg2_action: Literal["BUY", "SELL"]
    leg2_qty: float
    leg2_price: float


class Order(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    qty: float
    type: Literal["market", "limit"]
    time_in_force: Literal["gtc", "day"]
    timestamp: datetime


class Trade(BaseModel):
    signal: Signal
    entry_order: Order
    exit_order: Order


class AnalysisRequest(BaseModel):
    initial_capital: float


class AnalysisResponse(BaseModel):
    initial_capital: float
    total_profit: float
    return_pct: float
    n_trades: int
    n_entries: int
    n_exits: int
    total_buy_actions: int
    total_sell_actions: int
    winning_trades: int
    losing_trades: int
