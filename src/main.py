from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routes.emergency import router as emergency_router
from src.routes.live_trading import router as live_trading_router
from src.routes.market_hours import router as market_hours_router
from src.routes.strategy_management import router as strategy_router
from src.storage import MongoStorage
from src.utils.logger import get_logger

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = get_logger("main")
storage = MongoStorage()

app.state.storage = storage


@app.on_event("startup")
async def startup():
    logger.info("Application starting up...")


@app.on_event("shutdown")
async def shutdown():
    logger.info("Application shutting down...")


app.include_router(strategy_router, prefix="/strategies")
app.include_router(emergency_router, prefix="/emergency")
app.include_router(live_trading_router, prefix="/live-trading")
app.include_router(market_hours_router, prefix="/market")
