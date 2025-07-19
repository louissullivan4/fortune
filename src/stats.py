from threading import RLock

class StatsTracker:
    def __init__(self, initial_capital: float, risk_per_trade: float = 0.02):
        self._lock = RLock()
        self.risk = risk_per_trade
        self.reset()

    def reset(self):
        with self._lock:
            self.initial = 0.0
            self.equity = 0.0
            self.trades = 0
            self.entries = 0
            self.exits = 0
            self.buys = 0
            self.sells = 0
            self.wins = 0
            self.losses = 0
            self._open_entry = None

    def start_backtest(self, initial_capital: float):
        with self._lock:
            self.initial = initial_capital
            self.equity = initial_capital

    def on_signal(self, sig):
        with self._lock:
            if sig.signal_type == "ENTRY" and self._open_entry is None:
                max_notional = self.equity * self.risk
                sig.leg1_qty = max(1, int(max_notional / sig.leg1_price))
                self._open_entry = sig
                self.entries += 1
                self.buys    += (sig.leg1_action  == "BUY") + (sig.leg2_action  == "BUY")
                self.sells   += (sig.leg1_action  == "SELL") + (sig.leg2_action == "SELL")

            elif sig.signal_type == "EXIT" and self._open_entry is not None:
                ent = self._open_entry
                qty = ent.leg1_qty
                pnl = (ent.leg1_price  - sig.leg1_price) * qty \
                    + (sig.leg2_price - ent.leg2_price) * qty

                self.equity += pnl
                self.trades += 1
                self.exits  += 1
                self.buys   += (sig.leg1_action  == "BUY") + (sig.leg2_action  == "BUY")
                self.sells  += (sig.leg1_action  == "SELL") + (sig.leg2_action == "SELL")

                if pnl >= 0:
                    self.wins += 1
                else:
                    self.losses += 1

                self._open_entry = None

    def snapshot(self):
        with self._lock:
            return {
                "initial_capital":    self.initial,
                "total_profit":       round(self.equity - self.initial, 2),
                "return_pct":         round((self.equity / self.initial - 1) * 100, 2) if self.initial else 0,
                "n_trades":           self.trades,
                "n_entries":          self.entries,
                "n_exits":            self.exits,
                "total_buy_actions":  self.buys,
                "total_sell_actions": self.sells,
                "winning_trades":     self.wins,
                "losing_trades":      self.losses,
            }
