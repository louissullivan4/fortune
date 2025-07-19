from abc import ABC, abstractmethod
from src.models import Tick, Signal


class StrategyBase(ABC):
    @abstractmethod
    def on_tick(self, tick: Tick) -> Signal | None: ...
