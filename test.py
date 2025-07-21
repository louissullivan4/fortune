import asyncio
import os
from datetime import datetime
from alpaca.data.live import StockDataStream
from src.execution import BrokerExecutor
from src.models import Signal
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestQuoteRequest

# async def on_quote(quote):
#     print("Received quote:", quote)

# async def main():
#     stream = StockDataStream(
#         api_key="PK4WA8DUH3SSMZ4ART9T",
#         secret_key="uJ9KgELcP36zj0malVVhMLsCfNcUzuhvY40ewGNE",
#         url_override="wss://stream.data.alpaca.markets/v2/iex"
#     )
#     stream.subscribe_quotes(on_quote, "AAPL")
#     await stream._run_forever()

def get_latest_price(symbol: str, api_key: str, secret_key: str) -> float:
    client = StockHistoricalDataClient(api_key, secret_key)
    request = StockLatestQuoteRequest(symbol_or_symbols=symbol)
    quote = client.get_stock_latest_quote(request)
    return quote[symbol].ask_price

def calculate_quantity_for_budget(symbol: str, budget: float, api_key: str, secret_key: str) -> int:
    price = get_latest_price(symbol, api_key, secret_key)
    qty = int(budget // price)
    return max(qty, 1)  # Ensure at least 1 share if possible

def test_execute_trade_paper():
    # Ensure environment variables are set for Alpaca API
    api_key = os.getenv("ALPACA_API_KEY")
    secret_key = os.getenv("ALPACA_SECRET_KEY")
    assert api_key, "ALPACA_API_KEY not set"
    assert secret_key, "ALPACA_SECRET_KEY not set"

    budget = 10  # USD
    symbol = "AAPL"
    qty = calculate_quantity_for_budget(symbol, budget, api_key, secret_key)

    executor = BrokerExecutor(paper=True)
    signal = Signal(
        strategy="test-strategy",
        timestamp=datetime.now(),
        signal_type="ENTRY",
        leg1_symbol=symbol,
        leg1_action="BUY",
        leg1_qty=qty,
        leg1_price=0.0,
        leg2_symbol="",
        leg2_action="BUY",
        leg2_qty=0,
        leg2_price=0.0,
    )
    trade = executor.execute(signal)
    print(trade)

def test_execute_trade_sell_paper():
    # Ensure environment variables are set for Alpaca API
    api_key = os.getenv("ALPACA_API_KEY")
    secret_key = os.getenv("ALPACA_SECRET_KEY")
    assert api_key, "ALPACA_API_KEY not set"
    assert secret_key, "ALPACA_SECRET_KEY not set"

    budget = 10  # USD
    symbol = "AAPL"
    qty = calculate_quantity_for_budget(symbol, budget, api_key, secret_key)

    executor = BrokerExecutor(paper=True)
    signal = Signal(
        strategy="test-strategy-sell",
        timestamp=datetime.now(),
        signal_type="EXIT",
        leg1_symbol=symbol,
        leg1_action="SELL",
        leg1_qty=qty,
        leg1_price=0.0,
        leg2_symbol="",
        leg2_action="SELL",
        leg2_qty=0,
        leg2_price=0.0,
    )
    trade = executor.execute(signal)
    print(trade)

if __name__ == "__main__":
    test_execute_trade_paper()
    test_execute_trade_sell_paper()

# asyncio.run(main())