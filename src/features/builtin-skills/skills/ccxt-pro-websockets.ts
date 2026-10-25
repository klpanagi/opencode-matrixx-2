import type { BuiltinSkill } from "../types"

export const CCXT_PRO_WEBSOCKETS_SKILL_NAME = "ccxt-pro-websockets"

const CCXT_PRO_WEBSOCKETS_SKILL_DESCRIPTION =
  "Use when streaming live trades, order books, or tickers with ccxt.pro watch_* methods in Python — multiplexing, un_watch, cache limits, reconnection, and stale-snapshot pitfalls. Related: ccxt-rest, python-asyncio."

export const ccxtProWebsocketsSkill: BuiltinSkill = {
  name: CCXT_PRO_WEBSOCKETS_SKILL_NAME,
  description: CCXT_PRO_WEBSOCKETS_SKILL_DESCRIPTION,
  template: `# ccxt.pro — WebSocket Streaming

## THE watch_* MODEL

ccxt.pro exposes streaming through coroutine methods that RETURN the latest data each time they resolve. You call them in a loop; each resolution is a fresh snapshot or delta batch. The library owns the underlying websocket, reconnection, and (for order books) the local order-book cache.

\`\`\`python
import ccxt.pro as ccxtpro

exchange = ccxtpro.binance({"enableRateLimit": True})

async def trades_loop(symbol):
    while True:
        trades = await exchange.watch_trades(symbol)   # resolves on each new trade
        for t in trades:
            handle(t)
\`\`\`

Core methods: \`watch_trades(symbol)\`, \`watch_order_book(symbol, limit)\`, \`watch_ticker(symbol)\`, \`watch_ohlcv(symbol, timeframe)\`, \`watch_balance()\`. Each has a \`un_watch\` counterpart (\`un_watch_trades\`, ...) to drop a subscription when a unit stops.

## MULTIPLEXING MANY SYMBOLS

\`watchOrderBookForSymbols\` / \`watchTradesForSymbols\` subscribe to many symbols over ONE connection and resolve with a dict keyed by symbol:

\`\`\`python
symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
async def book_loop():
    while True:
        books = await exchange.watch_order_book_for_symbols(symbols, limit=50)
        for sym, book in books.items():
            handle_book(sym, book)
\`\`\`

One connection per exchange is the norm; opening a connection per symbol wastes sockets and hits connection limits. Per-symbol loops that each call \`watch_order_book\` on the same exchange share the connection automatically.

## SET CACHE LIMITS BEFORE THE FIRST WATCH

ccxt.pro keeps client-side deques of recent data. Their caps (\`tradesLimit\`, \`OHLCVLimit\`, \`ordersLimit\`, default 1000) are read when the FIRST watch call initializes the cache. Set them in the constructor, before any watch:

\`\`\`python
exchange = ccxtpro.binance({
    "enableRateLimit": True,
    "options": {
        "tradesLimit": 5000,    # default 1000
        "OHLCVLimit": 2000,
        "ordersLimit": 1000,
    },
})
\`\`\`

Changing them after the first watch has no effect on already-created caches.

## RECONNECTION AND THE STALE-SNAPSHOT PITFALL

ccxt.pro reconnects automatically with exponential backoff. When the connection drops, the next \`watch_*\` call re-subscribes and, for order books, re-fetches a fresh REST snapshot before resuming deltas. You do not manage the socket, but you MUST manage freshness:

- After a reconnect, buffered data from before the gap may resolve first. Do not treat "the call resolved" as "this data is current".
- Check \`orderbook["timestamp"]\` (or \`nonce\` where provided) against wall-clock time before acting on a book.
- On a long gap, drop accumulated state and wait for the first post-reconnect snapshot instead of stitching deltas across the hole.

\`\`\`python
import time

async def book_loop(symbol):
    while True:
        book = await exchange.watch_order_book(symbol, limit=50)
        age = time.time() * 1000 - (book.get("timestamp") or 0)
        if age > 5_000:
            logger.warning("%s book stale by %.1fs; ignoring", symbol, age / 1000)
            continue
        handle_book(symbol, book)
\`\`\`

## TIMEBOUNDS ON WATCH CALLS

A watch call that never resolves (dead socket, silent exchange) is a silent hang. Bound it:

\`\`\`python
try:
    trades = await asyncio.wait_for(exchange.watch_trades(symbol), timeout=30)
except asyncio.TimeoutError:
    logger.warning("%s: no trades within 30s; checking liveness", symbol)
\`\`\`

The timeout cancels the pending watch; the next loop iteration re-enters \`watch_*\`, which triggers re-subscription if needed.

## STOPPING A SUBSCRIPTION

When a symbol loop exits (fatal error, delisting), call the matching \`un_watch\` so the library unsubscribes and can close the stream:

\`\`\`python
await exchange.un_watch_trades(symbol)
\`\`\`

Leaving subscriptions running after their consumer died wastes bandwidth and keeps the connection pinned.

## LOOP SHAPE

\`\`\`python
async def stream_loop(exchange, symbol):
    while True:
        try:
            trades = await asyncio.wait_for(exchange.watch_trades(symbol), timeout=30)
            for t in trades:
                publish(t)
        except asyncio.TimeoutError:
            staleness.inc(symbol)                 # counted, not silent
        except ccxtpro.NetworkError as e:
            logger.warning("%s ws transient: %r", symbol, e)
            await asyncio.sleep(1)                # library also backs off internally
        except ccxtpro.ExchangeError as e:
            logger.error("%s ws fatal: %r", symbol, e)
            await exchange.un_watch_trades(symbol)
            break                                 # this loop dies, fleet lives
        except asyncio.CancelledError:
            await exchange.un_watch_trades(symbol)
            raise
\`\`\`

## RULES OF THUMB

- watch_* in a loop; each resolution is fresh data, not a callback registration.
- One exchange instance, one connection, many symbols; use the ForSymbols variants for tight multiplexing.
- Set tradesLimit/OHLCVLimit/ordersLimit in the constructor, before the first watch.
- Reconnection is automatic, but freshness is YOUR job: check timestamps, distrust data across a gap.
- wait_for every watch call; an unbounded await is a silent hang.
- un_watch when a unit stops; never leave orphan subscriptions.
- Classify exceptions per the ccxt error taxonomy; never swallow CancelledError.
`,
}
