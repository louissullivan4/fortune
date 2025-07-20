import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field
from enum import Enum
import os

from src.models import Signal, Trade, Strategy, StrategyStatus
from src.storage import MongoStorage
from src.execution import BrokerExecutor
from src.strategies.strategy_factory import StrategyFactory
from src.data_feed import MarketDataFeed
from src.utils.logger import get_logger


class LiveTradingStatus(str, Enum):
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"
    ERROR = "error"


@dataclass
class Position:
    symbol: str
    quantity: float
    entry_price: float
    current_price: float
    unrealized_pnl: float
    strategy_id: str
    strategy_name: str
    entry_time: datetime
    last_updated: datetime

    @property
    def market_value(self) -> float:
        return self.quantity * self.current_price

    @property
    def pnl_percentage(self) -> float:
        if self.entry_price == 0:
            return 0.0
        return ((self.current_price - self.entry_price) / self.entry_price) * 100


@dataclass
class LiveTradingState:
    status: LiveTradingStatus = LiveTradingStatus.STOPPED
    active_strategies: Set[str] = field(default_factory=set)
    positions: Dict[str, Position] = field(default_factory=dict)
    total_pnl: float = 0.0
    daily_pnl: float = 0.0
    total_trades: int = 0
    last_update: datetime = field(default_factory=datetime.utcnow)
    error_message: Optional[str] = None


class LiveTradingService:
    def __init__(self, storage: MongoStorage, paper_trading: bool = True):
        self.storage = storage
        self.logger = get_logger("live_trading")
        self.state = LiveTradingState()
        self.executor = BrokerExecutor(paper=paper_trading, simulate=False)
        self.data_feed: Optional[MarketDataFeed] = None
        self.strategies: Dict[str, any] = {}
        self.symbols: Set[str] = set()
        self.running = False
        self.paper_trading = paper_trading

    async def start(self) -> bool:
        """Start the live trading service"""
        try:
            self.logger.info("Starting live trading service...")
            
            # Load published strategies
            await self._load_published_strategies()
            
            if not self.strategies:
                self.logger.warning("No published strategies found for live trading")
                self.state.status = LiveTradingStatus.ERROR
                self.state.error_message = "No published strategies available"
                return False

            # Initialize data feed
            self.data_feed = MarketDataFeed(on_tick=self._on_tick)
            
            # Start data feed
            symbols_list = list(self.symbols)
            self.logger.info(f"Starting data feed for symbols: {symbols_list}")
            asyncio.create_task(self.data_feed.run(symbols_list))
            
            self.running = True
            self.state.status = LiveTradingStatus.RUNNING
            self.state.error_message = None
            self.logger.info("Live trading service started successfully")
            return True
            
        except Exception as e:
            self.logger.exception(f"Failed to start live trading service: {e}")
            self.state.status = LiveTradingStatus.ERROR
            self.state.error_message = str(e)
            return False

    async def stop(self) -> bool:
        """Stop the live trading service"""
        try:
            self.logger.info("Stopping live trading service...")
            
            self.running = False
            self.state.status = LiveTradingStatus.STOPPED
            
            # Stop data feed
            if self.data_feed:
                await self.data_feed.stop()
                self.data_feed = None
            
            # Close all positions if configured
            if os.getenv("CLOSE_POSITIONS_ON_STOP", "false").lower() == "true":
                await self._close_all_positions()
            
            self.logger.info("Live trading service stopped successfully")
            return True
            
        except Exception as e:
            self.logger.exception(f"Error stopping live trading service: {e}")
            return False

    async def pause(self) -> bool:
        """Pause live trading"""
        if self.state.status == LiveTradingStatus.RUNNING:
            self.state.status = LiveTradingStatus.PAUSED
            self.logger.info("Live trading paused")
            return True
        return False

    async def resume(self) -> bool:
        """Resume live trading"""
        if self.state.status == LiveTradingStatus.PAUSED:
            self.state.status = LiveTradingStatus.RUNNING
            self.logger.info("Live trading resumed")
            return True
        return False

    async def enable_strategy(self, strategy_id: str) -> bool:
        """Enable a specific strategy for live trading"""
        try:
            strategy = await self.storage.get_strategy(strategy_id)
            if not strategy:
                self.logger.error(f"Strategy not found: {strategy_id}")
                return False
            
            if strategy.status != StrategyStatus.PUBLISHED:
                self.logger.error(f"Strategy {strategy.name} is not published")
                return False
            
            # Create strategy instance
            strategy_instance = StrategyFactory.create_from_config(strategy.config)
            self.strategies[strategy_id] = strategy_instance
            
            # Add symbols to tracking
            if hasattr(strategy_instance, 's1'):
                self.symbols.add(strategy_instance.s1)
            if hasattr(strategy_instance, 's2'):
                self.symbols.add(strategy_instance.s2)
            
            self.state.active_strategies.add(strategy_id)
            self.logger.info(f"Enabled strategy for live trading: {strategy.name}")
            return True
            
        except Exception as e:
            self.logger.exception(f"Error enabling strategy {strategy_id}: {e}")
            return False

    async def disable_strategy(self, strategy_id: str) -> bool:
        """Disable a specific strategy from live trading"""
        try:
            if strategy_id in self.strategies:
                del self.strategies[strategy_id]
                self.state.active_strategies.discard(strategy_id)
                
                # Close positions for this strategy
                await self._close_strategy_positions(strategy_id)
                
                self.logger.info(f"Disabled strategy from live trading: {strategy_id}")
                return True
            return False
            
        except Exception as e:
            self.logger.exception(f"Error disabling strategy {strategy_id}: {e}")
            return False

    async def get_state(self) -> LiveTradingState:
        """Get current live trading state"""
        self.state.last_update = datetime.utcnow()
        return self.state

    async def get_positions(self) -> List[Position]:
        """Get all current positions"""
        return list(self.state.positions.values())

    async def _load_published_strategies(self):
        """Load all published strategies from database"""
        try:
            strategies = await self.storage.get_strategies(StrategyStatus.PUBLISHED.value)
            self.logger.info(f"Found {len(strategies)} published strategies")
            
            for strategy in strategies:
                try:
                    strategy_instance = StrategyFactory.create_from_config(strategy.config)
                    self.strategies[strategy.id] = strategy_instance
                    self.state.active_strategies.add(strategy.id)
                    
                    # Add symbols to tracking
                    if hasattr(strategy_instance, 's1'):
                        self.symbols.add(strategy_instance.s1)
                    if hasattr(strategy_instance, 's2'):
                        self.symbols.add(strategy_instance.s2)
                        
                    self.logger.info(f"Loaded strategy: {strategy.name}")
                    
                except Exception as e:
                    self.logger.error(f"Failed to load strategy {strategy.name}: {e}")
                    
        except Exception as e:
            self.logger.exception(f"Error loading published strategies: {e}")
            raise

    async def _on_tick(self, tick):
        """Handle incoming market data tick"""
        if not self.running or self.state.status != LiveTradingStatus.RUNNING:
            return
        
        try:
            # Update position prices
            await self._update_position_prices(tick)
            
            # Process strategies
            for strategy_id, strategy in self.strategies.items():
                try:
                    signal = strategy.on_tick(tick)
                    if signal:
                        await self._process_signal(signal, strategy_id)
                except Exception as e:
                    self.logger.error(f"Error processing strategy {strategy_id}: {e}")
                    
        except Exception as e:
            self.logger.exception(f"Error processing tick: {e}")

    async def _process_signal(self, signal: Signal, strategy_id: str):
        """Process a trading signal"""
        try:
            self.logger.info(f"Processing signal: {signal.signal_type} for {signal.leg1_symbol}")
            
            # Save signal to database
            await self.storage.save_signal(signal)
            
            # Execute trade
            trade = self.executor.execute(signal)
            await self.storage.save_trade(trade)
            
            # Update positions
            await self._update_positions_from_signal(signal, strategy_id)
            
            # Update metrics
            self.state.total_trades += 1
            self.state.last_update = datetime.utcnow()
            
            self.logger.info(f"Signal processed successfully: {signal.signal_type}")
            
        except Exception as e:
            self.logger.exception(f"Error processing signal: {e}")

    async def _update_positions_from_signal(self, signal: Signal, strategy_id: str):
        """Update positions based on a trading signal"""
        try:
            strategy = await self.storage.get_strategy(strategy_id)
            if not strategy:
                return
            
            # Handle entry signals
            if signal.signal_type == "ENTRY":
                # Create new position
                position = Position(
                    symbol=signal.leg1_symbol,
                    quantity=signal.leg1_qty if signal.leg1_action == "BUY" else -signal.leg1_qty,
                    entry_price=signal.leg1_price,
                    current_price=signal.leg1_price,
                    unrealized_pnl=0.0,
                    strategy_id=strategy_id,
                    strategy_name=strategy.name,
                    entry_time=signal.timestamp,
                    last_updated=signal.timestamp
                )
                self.state.positions[signal.leg1_symbol] = position
                
            # Handle exit signals
            elif signal.signal_type == "EXIT":
                if signal.leg1_symbol in self.state.positions:
                    position = self.state.positions[signal.leg1_symbol]
                    # Calculate realized P&L
                    realized_pnl = (signal.leg1_price - position.entry_price) * abs(position.quantity)
                    self.state.total_pnl += realized_pnl
                    self.state.daily_pnl += realized_pnl
                    
                    # Remove position
                    del self.state.positions[signal.leg1_symbol]
                    
        except Exception as e:
            self.logger.exception(f"Error updating positions: {e}")

    async def _update_position_prices(self, tick):
        """Update position prices with current market data"""
        try:
            if tick.symbol in self.state.positions:
                position = self.state.positions[tick.symbol]
                position.current_price = tick.price
                position.last_updated = tick.timestamp
                
                # Calculate unrealized P&L
                position.unrealized_pnl = (tick.price - position.entry_price) * position.quantity
                
        except Exception as e:
            self.logger.exception(f"Error updating position prices: {e}")

    async def _close_all_positions(self):
        """Close all open positions"""
        try:
            for symbol, position in list(self.state.positions.items()):
                await self._close_position(symbol, position)
        except Exception as e:
            self.logger.exception(f"Error closing all positions: {e}")

    async def _close_strategy_positions(self, strategy_id: str):
        """Close all positions for a specific strategy"""
        try:
            positions_to_close = [
                (symbol, position) for symbol, position in self.state.positions.items()
                if position.strategy_id == strategy_id
            ]
            
            for symbol, position in positions_to_close:
                await self._close_position(symbol, position)
                
        except Exception as e:
            self.logger.exception(f"Error closing strategy positions: {e}")

    async def _close_position(self, symbol: str, position: Position):
        """Close a specific position"""
        try:
            # Create exit signal
            signal = Signal(
                strategy=position.strategy_name,
                timestamp=datetime.utcnow(),
                signal_type="EXIT",
                leg1_symbol=symbol,
                leg1_action="SELL" if position.quantity > 0 else "BUY",
                leg1_qty=abs(position.quantity),
                leg1_price=position.current_price,
                leg2_symbol="",
                leg2_action="",
                leg2_qty=0,
                leg2_price=0
            )
            
            # Execute exit
            await self._process_signal(signal, position.strategy_id)
            
        except Exception as e:
            self.logger.exception(f"Error closing position {symbol}: {e}") 