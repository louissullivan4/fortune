from collections import deque
import numpy as np

class BollingerBands:
    def __init__(self, window: int, num_std: float):
        self.window = window
        self.num_std = num_std
        self.prices = deque(maxlen=window)

    def update(self, price: float):
        self.prices.append(price)
        if len(self.prices) < self.window:
            return None
        arr = np.array(self.prices)
        mean = arr.mean()
        std = arr.std(ddof=0)
        upper = mean + self.num_std * std
        lower = mean - self.num_std * std
        return mean, upper, lower 