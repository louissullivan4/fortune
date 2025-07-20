from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal, Optional, List, Dict, Any
from enum import Enum


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


class StrategyStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    DELETED = "deleted"


class BacktestResult(BaseModel):
    id: Optional[str] = None
    strategy_id: str
    strategy_name: str
    timestamp: datetime
    initial_capital: float
    test_duration_days: int
    total_profit: float
    return_pct: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    total_trades: int
    equity_curve: List[Dict[str, Any]]
    trades: List[Dict[str, Any]]


class Strategy(BaseModel):
    id: str
    name: str = Field(..., description="Unique name for this strategy")
    description: Optional[str] = None
    status: StrategyStatus = StrategyStatus.DRAFT
    created_at: datetime
    updated_at: datetime
    config: Dict[str, Any] = Field(
        ..., description="Strategy configuration as key-value pairs"
    )
    test_history: List[BacktestResult] = []


class StrategyCreate(BaseModel):
    name: str
    description: Optional[str] = None
    config: Dict[str, Any]


class StrategyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[StrategyStatus] = None
    config: Optional[Dict[str, Any]] = None


class BacktestRequest(BaseModel):
    initial_capital: float
    test_duration_days: int = 30


class StrategyConfig(BaseModel):
    name: str = Field(..., description="Unique name for this strategy instance")
    algorithm: Literal["pair", "PairTrading", "hedged", "HedgedPairTrading"]
    symbol1: str
    symbol2: str
    window: Optional[int] = None
    window_beta: Optional[int] = None
    window_z: Optional[int] = None
    entry_z: float
    exit_z: float
    qty: float
