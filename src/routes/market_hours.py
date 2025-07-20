from fastapi import APIRouter, HTTPException
from datetime import datetime, time, timedelta
import pytz
from typing import Dict, Any

router = APIRouter()

def get_market_status() -> Dict[str, Any]:
    """
    Get current US market status (NYSE/NASDAQ)
    Returns market open/close status and time until next change
    """
    # US Eastern Time (ET) - handles daylight saving automatically
    et_tz = pytz.timezone('US/Eastern')
    now_et = datetime.now(et_tz)
    
    # Market hours (9:30 AM - 4:00 PM ET, Monday-Friday)
    market_open = time(9, 30)  # 9:30 AM ET
    market_close = time(16, 0)  # 4:00 PM ET
    
    # Check if it's a weekday
    is_weekday = now_et.weekday() < 5  # Monday = 0, Friday = 4
    
    # Current time in ET
    current_time = now_et.time()
    
    # Market status logic
    if not is_weekday:
        # Weekend - market is closed
        next_monday = now_et + timedelta(days=(7 - now_et.weekday()))
        next_monday = next_monday.replace(hour=9, minute=30, second=0, microsecond=0)
        time_until_open = next_monday - now_et
        
        return {
            "status": "closed",
            "reason": "weekend",
            "is_open": False,
            "current_time_et": current_time.strftime("%H:%M:%S"),
            "market_open_time": market_open.strftime("%H:%M"),
            "market_close_time": market_close.strftime("%H:%M"),
            "time_until_open": {
                "days": time_until_open.days,
                "hours": time_until_open.seconds // 3600,
                "minutes": (time_until_open.seconds % 3600) // 60
            },
            "next_open": next_monday.strftime("%Y-%m-%d %H:%M ET")
        }
    
    elif current_time < market_open:
        # Before market open
        today_open = now_et.replace(hour=9, minute=30, second=0, microsecond=0)
        time_until_open = today_open - now_et
        
        return {
            "status": "closed",
            "reason": "before_market_open",
            "is_open": False,
            "current_time_et": current_time.strftime("%H:%M:%S"),
            "market_open_time": market_open.strftime("%H:%M"),
            "market_close_time": market_close.strftime("%H:%M"),
            "time_until_open": {
                "days": 0,
                "hours": time_until_open.seconds // 3600,
                "minutes": (time_until_open.seconds % 3600) // 60
            },
            "next_open": today_open.strftime("%Y-%m-%d %H:%M ET")
        }
    
    elif current_time >= market_open and current_time < market_close:
        # Market is open
        today_close = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
        time_until_close = today_close - now_et
        
        return {
            "status": "open",
            "reason": "market_open",
            "is_open": True,
            "current_time_et": current_time.strftime("%H:%M:%S"),
            "market_open_time": market_open.strftime("%H:%M"),
            "market_close_time": market_close.strftime("%H:%M"),
            "time_until_close": {
                "days": 0,
                "hours": time_until_close.seconds // 3600,
                "minutes": (time_until_close.seconds % 3600) // 60
            },
            "next_close": today_close.strftime("%Y-%m-%d %H:%M ET")
        }
    
    else:
        # After market close
        tomorrow_open = (now_et + timedelta(days=1)).replace(hour=9, minute=30, second=0, microsecond=0)
        time_until_open = tomorrow_open - now_et
        
        return {
            "status": "closed",
            "reason": "after_market_close",
            "is_open": False,
            "current_time_et": current_time.strftime("%H:%M:%S"),
            "market_open_time": market_open.strftime("%H:%M"),
            "market_close_time": market_close.strftime("%H:%M"),
            "time_until_open": {
                "days": time_until_open.days,
                "hours": time_until_open.seconds // 3600,
                "minutes": (time_until_open.seconds % 3600) // 60
            },
            "next_open": tomorrow_open.strftime("%Y-%m-%d %H:%M ET")
        }

@router.get("/market-status")
async def get_market_status_endpoint():
    """
    Get current US market status
    """
    try:
        return get_market_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting market status: {str(e)}")

@router.get("/market-hours")
async def get_market_hours():
    """
    Get market hours information
    """
    return {
        "market_hours": {
            "open": "09:30 ET",
            "close": "16:00 ET",
            "timezone": "US/Eastern",
            "days": "Monday - Friday",
            "holidays": "Closed on US federal holidays"
        },
        "current_time_et": datetime.now(pytz.timezone('US/Eastern')).strftime("%Y-%m-%d %H:%M:%S ET")
    } 