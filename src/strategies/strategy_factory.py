from typing import Dict, Type

from src.strategies.pair_trading import PairTrading


class StrategyFactory:
    _registry: Dict[str, Type] = {
        "pair": PairTrading,
        "PairTrading": PairTrading,
    }

    @classmethod
    def create(cls, cfg: dict):
        alg = cfg.get("algorithm", "pair")
        StrategyClass = cls._registry.get(alg)
        if not StrategyClass:
            raise ValueError(f"Unknown algorithm '{alg}'")

        return StrategyClass(
            symbol1=cfg["symbol1"],
            symbol2=cfg["symbol2"],
            window=cfg["window"],
            entry_z=cfg["entry_z"],
            exit_z=cfg["exit_z"],
            risk_per_trade=cfg["risk_per_trade"],
        )

    @classmethod
    def create_from_config(cls, config: dict):
        """Create strategy instance from strategy config dictionary"""
        return cls.create(config)
