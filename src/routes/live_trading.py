from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List, Optional

from src.models import Strategy, StrategyStatus
from src.storage import MongoStorage
from src.live_trading import LiveTradingService, LiveTradingState, Position
from src.utils.logger import get_logger

router = APIRouter(tags=["live_trading"])
logger = get_logger("live_trading_routes")


async def get_storage(request: Request) -> MongoStorage:
    return request.app.state.storage


async def get_live_trading_service(request: Request) -> LiveTradingService:
    if not hasattr(request.app.state, "live_trading_service"):
        # Initialize live trading service if not exists
        storage = request.app.state.storage
        paper_trading = request.app.state.config.get("paper_trading", True)
        request.app.state.live_trading_service = LiveTradingService(
            storage=storage, 
            paper_trading=paper_trading
        )
    return request.app.state.live_trading_service


@router.post("/start", summary="Start live trading service")
async def start_live_trading(
    storage: MongoStorage = Depends(get_storage),
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Start the live trading service with all published strategies"""
    try:
        success = await live_service.start()
        if success:
            return {"message": "Live trading service started successfully", "status": "running"}
        else:
            raise HTTPException(500, "Failed to start live trading service")
    except Exception as e:
        logger.exception(f"Error starting live trading: {e}")
        raise HTTPException(500, f"Failed to start live trading: {str(e)}")


@router.post("/stop", summary="Stop live trading service")
async def stop_live_trading(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Stop the live trading service"""
    try:
        success = await live_service.stop()
        if success:
            return {"message": "Live trading service stopped successfully", "status": "stopped"}
        else:
            raise HTTPException(500, "Failed to stop live trading service")
    except Exception as e:
        logger.exception(f"Error stopping live trading: {e}")
        raise HTTPException(500, f"Failed to stop live trading: {str(e)}")


@router.post("/pause", summary="Pause live trading")
async def pause_live_trading(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Pause live trading (stop processing new signals)"""
    try:
        success = await live_service.pause()
        if success:
            return {"message": "Live trading paused successfully", "status": "paused"}
        else:
            raise HTTPException(400, "Cannot pause live trading - service not running")
    except Exception as e:
        logger.exception(f"Error pausing live trading: {e}")
        raise HTTPException(500, f"Failed to pause live trading: {str(e)}")


@router.post("/resume", summary="Resume live trading")
async def resume_live_trading(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Resume live trading (start processing new signals)"""
    try:
        success = await live_service.resume()
        if success:
            return {"message": "Live trading resumed successfully", "status": "running"}
        else:
            raise HTTPException(400, "Cannot resume live trading - service not paused")
    except Exception as e:
        logger.exception(f"Error resuming live trading: {e}")
        raise HTTPException(500, f"Failed to resume live trading: {str(e)}")


@router.get("/status", summary="Get live trading status")
async def get_live_trading_status(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Get current live trading status and metrics"""
    try:
        state = await live_service.get_state()
        return {
            "status": state.status.value,
            "active_strategies": list(state.active_strategies),
            "total_pnl": state.total_pnl,
            "daily_pnl": state.daily_pnl,
            "total_trades": state.total_trades,
            "last_update": state.last_update.isoformat(),
            "error_message": state.error_message,
            "paper_trading": live_service.paper_trading
        }
    except Exception as e:
        logger.exception(f"Error getting live trading status: {e}")
        raise HTTPException(500, f"Failed to get live trading status: {str(e)}")


@router.get("/positions", summary="Get current positions")
async def get_positions(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Get all current open positions"""
    try:
        positions = await live_service.get_positions()
        return [
            {
                "symbol": pos.symbol,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "current_price": pos.current_price,
                "unrealized_pnl": pos.unrealized_pnl,
                "market_value": pos.market_value,
                "pnl_percentage": pos.pnl_percentage,
                "strategy_id": pos.strategy_id,
                "strategy_name": pos.strategy_name,
                "entry_time": pos.entry_time.isoformat(),
                "last_updated": pos.last_updated.isoformat()
            }
            for pos in positions
        ]
    except Exception as e:
        logger.exception(f"Error getting positions: {e}")
        raise HTTPException(500, f"Failed to get positions: {str(e)}")


@router.get("/strategies", summary="Get available strategies for live trading")
async def get_available_strategies(
    storage: MongoStorage = Depends(get_storage),
):
    """Get all published strategies that can be used for live trading"""
    try:
        strategies = await storage.get_strategies(StrategyStatus.PUBLISHED.value)
        return [
            {
                "id": strategy.id,
                "name": strategy.name,
                "description": strategy.description,
                "status": strategy.status.value,
                "created_at": strategy.created_at.isoformat(),
                "updated_at": strategy.updated_at.isoformat()
            }
            for strategy in strategies
        ]
    except Exception as e:
        logger.exception(f"Error getting available strategies: {e}")
        raise HTTPException(500, f"Failed to get available strategies: {str(e)}")


@router.post("/strategies/{strategy_id}/enable", summary="Enable strategy for live trading")
async def enable_strategy(
    strategy_id: str,
    live_service: LiveTradingService = Depends(get_live_trading_service),
    storage: MongoStorage = Depends(get_storage),
):
    """Enable a specific published strategy for live trading"""
    try:
        # Verify strategy exists and is published
        strategy = await storage.get_strategy(strategy_id)
        if not strategy:
            raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
        
        if strategy.status != StrategyStatus.PUBLISHED:
            raise HTTPException(400, f"Strategy '{strategy.name}' is not published")
        
        # Enable strategy
        success = await live_service.enable_strategy(strategy_id)
        if success:
            return {"message": f"Strategy '{strategy.name}' enabled for live trading"}
        else:
            raise HTTPException(500, f"Failed to enable strategy '{strategy.name}'")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error enabling strategy {strategy_id}: {e}")
        raise HTTPException(500, f"Failed to enable strategy: {str(e)}")


@router.post("/strategies/{strategy_id}/disable", summary="Disable strategy from live trading")
async def disable_strategy(
    strategy_id: str,
    live_service: LiveTradingService = Depends(get_live_trading_service),
    storage: MongoStorage = Depends(get_storage),
):
    """Disable a specific strategy from live trading"""
    try:
        # Verify strategy exists
        strategy = await storage.get_strategy(strategy_id)
        if not strategy:
            raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
        
        # Disable strategy
        success = await live_service.disable_strategy(strategy_id)
        if success:
            return {"message": f"Strategy '{strategy.name}' disabled from live trading"}
        else:
            raise HTTPException(400, f"Strategy '{strategy.name}' is not currently active in live trading")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error disabling strategy {strategy_id}: {e}")
        raise HTTPException(500, f"Failed to disable strategy: {str(e)}")


@router.get("/metrics", summary="Get live trading metrics")
async def get_live_trading_metrics(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Get comprehensive live trading metrics and performance data"""
    try:
        state = await live_service.get_state()
        positions = await live_service.get_positions()
        
        # Calculate additional metrics
        total_positions = len(positions)
        total_market_value = sum(pos.market_value for pos in positions)
        total_unrealized_pnl = sum(pos.unrealized_pnl for pos in positions)
        
        # Calculate win rate from positions (simplified)
        profitable_positions = sum(1 for pos in positions if pos.unrealized_pnl > 0)
        win_rate = (profitable_positions / total_positions * 100) if total_positions > 0 else 0
        
        return {
            "performance": {
                "total_pnl": state.total_pnl,
                "daily_pnl": state.daily_pnl,
                "total_trades": state.total_trades,
                "win_rate": round(win_rate, 2)
            },
            "positions": {
                "total_positions": total_positions,
                "total_market_value": total_market_value,
                "total_unrealized_pnl": total_unrealized_pnl
            },
            "system": {
                "status": state.status.value,
                "active_strategies": len(state.active_strategies),
                "paper_trading": live_service.paper_trading,
                "last_update": state.last_update.isoformat()
            }
        }
    except Exception as e:
        logger.exception(f"Error getting live trading metrics: {e}")
        raise HTTPException(500, f"Failed to get live trading metrics: {str(e)}") 