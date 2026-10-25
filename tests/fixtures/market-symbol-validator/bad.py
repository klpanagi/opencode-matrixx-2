import ccxt

EXCHANGE = "binance"
PERP = "BTC/USDT"
NATIVE = "ETHUSDT"


def load(exchange):
    ticker = exchange.fetch_ticker("BTC/USDT")
    ohlcv = exchange.fetch_ohlcv("BTC/USDT", "1h")
    return ticker, ohlcv
