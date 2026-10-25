def load(exchange):
    symbol = "BTC/USDT:USDT"
    if exchange.has["fetchOHLCV"]:
        return exchange.fetch_ohlcv(symbol, "1h")
    return None
