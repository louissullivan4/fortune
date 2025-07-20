from fastapi import APIRouter, Request, HTTPException
from datetime import datetime
from src.models import Signal
from src.utils.logger import get_logger

router = APIRouter(tags=["emergency"])
logger = get_logger("emergency")


@router.post("/pause", summary="Pause all trading")
async def pause_trading(request: Request):
    """Pause all live trading activities"""
    try:
        # This endpoint is now deprecated since we use the live trading service
        # The pause functionality is handled by the live trading service
        logger.warning("Emergency pause endpoint called - use /live-trading/pause instead")
        return {"message": "Emergency pause endpoint deprecated. Use /live-trading/pause instead."}
    except Exception as e:
        logger.error(f"Error in emergency pause: {e}")
        raise HTTPException(500, f"Failed to pause trading: {str(e)}")


@router.post("/resume", summary="Resume trading")
async def resume_trading(request: Request):
    """Resume all live trading activities"""
    try:
        # This endpoint is now deprecated since we use the live trading service
        # The resume functionality is handled by the live trading service
        logger.warning("Emergency resume endpoint called - use /live-trading/resume instead")
        return {"message": "Emergency resume endpoint deprecated. Use /live-trading/resume instead."}
    except Exception as e:
        logger.error(f"Error in emergency resume: {e}")
        raise HTTPException(500, f"Failed to resume trading: {str(e)}")


@router.post("/dump_positions", summary="Exit all current positions immediately")
async def dump_positions(request: Request):
    """Emergency dump all positions - use live trading service instead"""
    try:
        # This endpoint is now deprecated since we use the live trading service
        # Position management is handled by the live trading service
        logger.warning("Emergency dump positions endpoint called - use live trading service instead")
        return {"message": "Emergency dump positions endpoint deprecated. Use live trading service for position management."}
    except Exception as e:
        logger.error(f"Error in emergency dump positions: {e}")
        raise HTTPException(500, f"Failed to dump positions: {str(e)}")


@router.get("/status", summary="Get trading paused status")
async def get_trading_status(request: Request):
    """Get current trading status"""
    try:
        # This endpoint is now deprecated since we use the live trading service
        # Status is handled by the live trading service
        logger.warning("Emergency status endpoint called - use /live-trading/status instead")
        return {"message": "Emergency status endpoint deprecated. Use /live-trading/status instead."}
    except Exception as e:
        logger.error(f"Error getting emergency status: {e}")
        raise HTTPException(500, f"Failed to get status: {str(e)}")
