from datetime import datetime
from typing import List, Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException, Path, Request

from src.backtest_engine import BacktestEngine
from src.models import (
    BacktestRequest,
    BacktestResult,
    Strategy,
    StrategyCreate,
    StrategyStatus,
    StrategyUpdate,
)
from src.storage import MongoStorage
from src.utils.logger import get_logger

router = APIRouter(tags=["strategies"])
logger = get_logger("strategy_management")


async def get_storage(request: Request) -> MongoStorage:
    return request.app.state.storage


@router.get("/", response_model=List[Strategy], summary="List all strategies")
async def list_strategies(
    status: Optional[StrategyStatus] = None,
    storage: MongoStorage = Depends(get_storage),
):
    return await storage.get_strategies(status.value if status else None)


@router.post("/", response_model=Strategy, summary="Create a new strategy")
async def create_strategy(
    strategy_data: StrategyCreate, storage: MongoStorage = Depends(get_storage)
):
    existing = await storage.get_strategies()
    if any(s.name == strategy_data.name for s in existing):
        raise HTTPException(
            400, f"Strategy with name '{strategy_data.name}' already exists"
        )
    strategy = Strategy(
        id="",
        name=strategy_data.name,
        description=strategy_data.description,
        status=StrategyStatus.DRAFT,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        config=strategy_data.config,
        test_history=[],
    )
    strategy.id = await storage.save_strategy(strategy)
    logger.info(f"Created new strategy: {strategy.name}")
    return strategy


@router.get(
    "/{strategy_id}", response_model=Strategy, summary="Get a specific strategy"
)
async def get_strategy(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    return strategy


@router.put("/{strategy_id}", response_model=Strategy, summary="Update a strategy")
async def update_strategy(
    strategy_update: StrategyUpdate,
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    if strategy_update.name is not None:
        strategy.name = strategy_update.name
    if strategy_update.description is not None:
        strategy.description = strategy_update.description
    if strategy_update.status is not None:
        strategy.status = strategy_update.status
    if strategy_update.config is not None:
        strategy.config = strategy_update.config
    strategy.updated_at = datetime.utcnow()
    await storage.save_strategy(strategy)
    logger.info(f"Updated strategy: {strategy.name}")
    return strategy


@router.delete("/{strategy_id}", summary="Delete a strategy")
async def delete_strategy(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    success = await storage.delete_strategy(strategy_id)
    if not success:
        raise HTTPException(500, "Failed to delete strategy")
    logger.info(f"Deleted strategy: {strategy.name}")
    return {"message": f"Strategy '{strategy.name}' deleted successfully"}


@router.post(
    "/{strategy_id}/publish", response_model=Strategy, summary="Publish a strategy"
)
async def publish_strategy(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    if strategy.status != StrategyStatus.DRAFT:
        raise HTTPException(
            400,
            f"Only draft strategies can be published. Current status: {strategy.status}",
        )
    strategy.status = StrategyStatus.PUBLISHED
    strategy.updated_at = datetime.utcnow()
    await storage.save_strategy(strategy)
    logger.info(f"Published strategy: {strategy.name}")
    return strategy


@router.post(
    "/{strategy_id}/unpublish", response_model=Strategy, summary="Unpublish a strategy"
)
async def unpublish_strategy(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    if strategy.status != StrategyStatus.PUBLISHED:
        raise HTTPException(
            400,
            f"Only published strategies can be unpublished. Current status: {strategy.status}",
        )
    strategy.status = StrategyStatus.DRAFT
    strategy.updated_at = datetime.utcnow()
    await storage.save_strategy(strategy)
    logger.info(f"Unpublished strategy: {strategy.name}")
    return strategy


@router.post(
    "/{strategy_id}/backtest",
    response_model=BacktestResult,
    summary="Run a backtest on a strategy",
)
async def run_backtest(
    backtest_request: BacktestRequest,
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    engine = BacktestEngine(storage=storage)
    try:
        result = await engine.run_backtest(
            strategy_id,
            backtest_request.initial_capital,
            backtest_request.test_duration_days,
        )
        if result is None:
            raise HTTPException(400, "Invalid strategy configuration")
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception(f"Backtest failed: {e}")
        raise HTTPException(500, f"Backtest failed: {e}")


@router.get(
    "/{strategy_id}/backtests",
    response_model=List[BacktestResult],
    summary="Get backtest history for a strategy",
)
async def get_backtest_history(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    try:
        results = await storage.get_backtest_results(strategy_id)
        return results
    except Exception as e:
        logger.exception(f"Failed to retrieve backtest results: {e}")
        raise HTTPException(500, f"Failed to retrieve backtest results: {e}")


@router.post("/{strategy_id}/config/yaml", summary="Update strategy config from YAML")
async def update_config_from_yaml(
    yaml_config: str,
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    try:
        config = yaml.safe_load(yaml_config)
        if not isinstance(config, dict):
            raise ValueError("YAML must contain a dictionary")
        strategy.config = config
        strategy.updated_at = datetime.utcnow()
        await storage.save_strategy(strategy)
        logger.info(f"Updated config from YAML for strategy: {strategy.name}")
        return {"message": "Configuration updated successfully", "config": config}
    except yaml.YAMLError as e:
        raise HTTPException(400, f"Invalid YAML: {e}")
    except Exception as e:
        raise HTTPException(400, f"Invalid configuration: {e}")


@router.get("/{strategy_id}/config/yaml", summary="Get strategy config as YAML")
async def get_config_as_yaml(
    strategy_id: str = Path(..., description="ID of the strategy"),
    storage: MongoStorage = Depends(get_storage),
):
    strategy = await storage.get_strategy(strategy_id)
    if not strategy:
        raise HTTPException(404, f"Strategy with ID '{strategy_id}' not found")
    try:
        return {
            "yaml": yaml.dump(
                strategy.config, default_flow_style=False, sort_keys=False
            )
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to convert config to YAML: {e}")
