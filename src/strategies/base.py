from abc import ABC, abstractmethod

from src.models import Signal, Tick


class StrategyBase(ABC):
    @abstractmethod
    def on_tick(self, tick: Tick) -> Signal | None: ...
