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
        if StrategyClass is PairTrading:
            return StrategyClass(
                symbol1=cfg["symbol1"],
                symbol2=cfg["symbol2"],
                window=cfg["window"],
                entry_z=cfg["entry_z"],
                exit_z=cfg["exit_z"],
                risk_per_trade=cfg["risk_per_trade"],
            )
        else:
            return StrategyClass(
                symbol1=cfg["symbol1"],
                symbol2=cfg["symbol2"],
                window_beta=cfg["window_beta"],
                window_z=cfg["window_z"],
                entry_z=cfg["entry_z"],
                exit_z=cfg["exit_z"],
                risk_per_trade=cfg["risk_per_trade"],
            )

    @classmethod
    def create_from_config(cls, config: dict):
        """Create strategy instance from strategy config dictionary"""
        # Extract the algorithm and parameters from the config
        algorithm = config.get("algorithm", "pair")
        
        # Create strategy using the existing create method
        return cls.create(config)
