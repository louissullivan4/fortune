from typing import Dict, Type

from src.strategies.pair_trading import PairTrading
from src.strategies.bollinger_reversion import BollingerReversionStrategy


class StrategyFactory:
    _registry: Dict[str, Type] = {
        "pair": PairTrading,
        "PairTrading": PairTrading,
        "bollinger_reversion": BollingerReversionStrategy,
        "BollingerReversionStrategy": BollingerReversionStrategy,
    }

    @classmethod
    def create(cls, cfg: dict):
        alg = cfg.get("algorithm", "pair")
        StrategyClass = cls._registry.get(alg)
        if not StrategyClass:
            raise ValueError(f"Unknown algorithm '{alg}'")

        # PairTrading expects two symbols, BollingerReversionStrategy expects one
        if alg in ("pair", "PairTrading"):
            return StrategyClass(
                symbol1=cfg["symbol1"],
                symbol2=cfg["symbol2"],
                window=cfg["window"],
                entry_z=cfg["entry_z"],
                exit_z=cfg["exit_z"],
                risk_per_trade=cfg["risk_per_trade"],
            )
        elif alg in ("bollinger_reversion", "BollingerReversionStrategy"):
            return StrategyClass(
                symbol=cfg["symbol"],
                window=cfg.get("window", 20),
                num_std=cfg.get("num_std", 2.0),
                risk_per_trade=cfg.get("risk_per_trade", 1000.0),
            )
        else:
            raise ValueError(f"Unknown algorithm '{alg}'")

    @classmethod
    def create_from_config(cls, config: dict):
        """Create strategy instance from strategy config dictionary"""
        return cls.create(config)
