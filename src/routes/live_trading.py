from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect
from typing import List, Optional

from src.models import Strategy, StrategyStatus
from src.storage import MongoStorage
from src.live_trading import LiveTradingService, LiveTradingState, Position
from src.utils.logger import get_logger

import asyncio
import json
import os

router = APIRouter(tags=["live_trading"])
logger = get_logger("live_trading_routes")


async def get_storage(request: Request) -> MongoStorage:
    return request.app.state.storage


async def get_live_trading_service(request: Request) -> LiveTradingService:
    if not hasattr(request.app.state, "live_trading_service"):
        # Initialize live trading service if not exists
        storage = request.app.state.storage
        paper_trading = os.getenv("ALPACA_USE_TEST", "true").lower() == True
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
    """Stop the live trading service with improved error handling"""
    try:
        logger.info("Received stop request for live trading service")
        
        # Check current status
        current_state = await live_service.get_state()
        if current_state.status.value == "stopped":
            return {"message": "Live trading service is already stopped", "status": "stopped"}
        
        # Attempt to stop with timeout
        try:
            success = await asyncio.wait_for(live_service.stop(), timeout=45.0)
        except asyncio.TimeoutError:
            logger.warning("Stop operation timed out, but service should be marked as stopped")
            # Even if timeout, the service should be marked as stopped
            success = True
        
        if success:
            logger.info("Live trading service stopped successfully")
            return {"message": "Live trading service stopped successfully", "status": "stopped"}
        else:
            logger.warning("Stop operation returned False, but continuing gracefully")
            return {"message": "Live trading service stop completed with warnings", "status": "stopped"}
            
    except Exception as e:
        logger.exception(f"Error stopping live trading: {e}")
        # Don't throw 500 error, instead return a warning response
        return {
            "message": f"Live trading service stop completed with errors: {str(e)}", 
            "status": "stopped",
            "warning": True
        }


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


@router.get("/risk", summary="Get current risk level")
async def get_risk_level(
    live_service: LiveTradingService = Depends(get_live_trading_service),
):
    """Get current risk level and risk score for live trading"""
    try:
        positions = await live_service.get_positions()
        total_market_value = sum(pos.market_value for pos in positions)
        total_unrealized_pnl = sum(pos.unrealized_pnl for pos in positions)
        risk_score = 0.0
        risk_level = "low"
        if total_market_value > 0:
            risk_score = total_unrealized_pnl / total_market_value
            if risk_score > -0.02:
                risk_level = "low"
            elif risk_score > -0.05:
                risk_level = "medium"
            else:
                risk_level = "high"
        return {
            "risk_level": risk_level,
            "risk_score": round(risk_score, 4),
            "total_market_value": total_market_value,
            "total_unrealized_pnl": total_unrealized_pnl
        }
    except Exception as e:
        logger.exception(f"Error getting risk level: {e}")
        return {"risk_level": "unknown", "risk_score": None} 

# Global set of connected WebSocket clients
live_feed_clients = set()

@router.get("/ws-status", summary="Get WebSocket client status")
async def get_websocket_status():
    """Get current WebSocket client connection status"""
    return {
        "connected_clients": len(live_feed_clients),
        "has_clients": len(live_feed_clients) > 0
    }

@router.websocket("/ws/live-feed")
async def websocket_live_feed(websocket: WebSocket):
    await websocket.accept()
    live_feed_clients.add(websocket)
    logger.info(f"WebSocket client connected. Total clients: {len(live_feed_clients)}")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        live_feed_clients.discard(websocket)
        logger.info(f"WebSocket client removed. Total clients: {len(live_feed_clients)}") 