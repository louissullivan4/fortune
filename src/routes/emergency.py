from fastapi import APIRouter, Request
from datetime import datetime
from src.models import Signal

router = APIRouter(tags=["emergency"])


@router.post("/pause", summary="Pause all trading")
async def pause_trading(request: Request):
    request.app.state.paused = True
    return {"message": "Trading paused. No new signals will be generated."}


@router.post("/resume", summary="Resume trading")
async def resume_trading(request: Request):
    request.app.state.paused = False
    return {"message": "Trading resumed. on_tick will process signals again."}


@router.post("/dump_positions", summary="Exit all current positions immediately")
async def dump_positions(request: Request):
    app = request.app
    dumped = []
    now = datetime.utcnow()

    for name, strat in app.state.strategies.items():
        if getattr(strat, "in_position", False):
            sig = Signal(
                strategy=name,
                timestamp=now,
                signal_type="EXIT",
                leg1_symbol=strat.s1,
                leg1_action="BUY" if strat.__dict__.get("in_position") else "SELL",
                leg1_qty=strat.qty,
                leg1_price=strat.buf1[-1],
                leg2_symbol=strat.s2,
                leg2_action="SELL" if strat.__dict__.get("in_position") else "BUY",
                leg2_qty=strat.qty,
                leg2_price=strat.buf2[-1],
            )
            strat.in_position = False

            await app.state.storage.save_signal(sig)
            trade = app.state.executor.execute(sig)
            await app.state.storage.save_trade(trade)

            dumped.append(name)

    if not dumped:
        return {"message": "No open positions to dump."}

    return {"message": f"Dumped positions for strategies: {', '.join(dumped)}"}


@router.get("/status", summary="Get trading paused status")
async def get_trading_status(request: Request):
    paused = getattr(request.app.state, "paused", False)
    return {"paused": paused}
