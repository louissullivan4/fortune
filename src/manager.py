import threading
from typing import Dict, List
from src.strategies.base import StrategyBase
from src.utils.logger import get_logger

class StrategyManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._strategies: Dict[str, List[StrategyBase]] = {}
        self.logger = get_logger("strategy_manager")

    def register(self, name: str, strat: StrategyBase):
        with self._lock:
            self._strategies.setdefault(name, []).append(strat)
            self.logger.info(f"Registered strategy {strat.__class__.__name__} under '{name}'")

    def unregister(self, name: str, strat_class: str):
        with self._lock:
            lst = self._strategies.get(name, [])
            self._strategies[name] = [s for s in lst if s.__class__.__name__ != strat_class]
            self.logger.info(f"Unregistered {strat_class} from '{name}'")

    def run_all(self, tick):
        with self._lock:
            syms = self._strategies.get(tick.symbol, [])
        for strat in syms:
            sig = strat.on_tick(tick)
            if sig:
                yield sig

    def list(self):
        with self._lock:
            return {k: [s.__class__.__name__ for s in v] for k, v in self._strategies.items()}
