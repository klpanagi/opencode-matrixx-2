import type { BuiltinSkill } from "../types"

export const CCXT_REST_SKILL_NAME = "ccxt-rest"

const CCXT_REST_SKILL_DESCRIPTION =
  "Use when fetching market data or trading via ccxt REST in Python — client lifecycle, load_markets, unified symbols, rate limiting, capability gating, and the error taxonomy. Related: ccxt-pro-websockets, resilience-error-taxonomy."

export const ccxtRestSkill: BuiltinSkill = {
  name: CCXT_REST_SKILL_NAME,
  description: CCXT_REST_SKILL_DESCRIPTION,
  template: `# ccxt REST — Client Lifecycle and Conventions

## ONE CLIENT PER EXCHANGE, PROCESS LIFETIME

Create one async ccxt client per exchange and own it for the whole process. The client holds the market cache, the rate-limit token bucket, and connection state; recreating it per request throws all of that away and hammers the exchange with market reloads.

\`\`\`python
import ccxt.async_support as ccxt

exchange = ccxt.binance({
    "apiKey": KEY,
    "secret": SECRET,
    "enableRateLimit": True,   # per-instance token bucket
})
try:
    await exchange.load_markets()
    # ... run for the process lifetime ...
finally:
    await exchange.close()     # ALWAYS close; leaks sockets otherwise
\`\`\`

## load_markets AND PERIODIC RELOAD

\`await exchange.load_markets()\` fetches the full market list once and caches it. Call it once at startup before any symbol resolution. Exchanges add/delist markets and change filters, so schedule a periodic reload (e.g. every few hours, or on \`BadSymbol\` for a symbol you expected to exist):

\`\`\`python
await exchange.load_markets()          # initial
# later, periodically:
await exchange.load_markets(reload=True)
\`\`\`

## UNIFIED SYMBOLS

ccxt uses unified symbols: \`BTC/USDT\` for spot, \`BTC/USDT:USDT\` for the USDT-margined perpetual (the part after the colon is the settle currency), \`BTC/USD:BTC\` for inverse. \`exchange.market(symbol)\` raises \`BadSymbol\` for anything not in the loaded market list. Never hardcode exchange-native ids like \`BTCUSDT\` or \`XBT-USDT\`; iterate \`exchange.symbols\` to discover what the exchange actually offers:

\`\`\`python
perps = [s for s in exchange.symbols if s.endswith(":USDT")]
for sym in perps:
    m = exchange.market(sym)   # raises BadSymbol if unknown
    print(sym, m["id"], m["type"], m["active"])
\`\`\`

Filter on \`market["active"]\` before trading; delisted markets still appear in the list.

## CAPABILITY GATING

Exchanges differ wildly. Gate every call on \`exchange.has\` instead of assuming:

\`\`\`python
if exchange.has.get("fetchOHLCV"):
    candles = await exchange.fetch_ohlcv("BTC/USDT", "1m", limit=500)
else:
    logger.warning("%s lacks fetchOHLCV; falling back to trades", exchange.id)
\`\`\`

\`exchange.has\` is a dict-like of booleans (\`fetchTicker\`, \`fetchOrderBook\`, \`fetchTrades\`, \`fetchOHLCV\`, \`createOrder\`, ...). A missing capability is a fatal, per-exchange condition, not a retryable error.

## RATE LIMITING

\`enableRateLimit=True\` gives each client instance a built-in token bucket that throttles requests automatically. Never disable it to "go faster" and never try to parallelize through one instance by turning it off: you will get \`RateLimitExceeded\` and IP bans. If you need more throughput, run SEPARATE client instances (each has its own bucket) and respect the exchange's per-endpoint weights. Keep the flag on even for a single instance; the cost is negligible.

## ERROR TAXONOMY

ccxt exceptions split into a transient family and a fatal family. The response differs: retry the transient ones with backoff, never retry the fatal ones.

| Exception | Family | Meaning | Response |
|---|---|---|---|
| NetworkError (base) | transient | connectivity, DNS, HTTP 5xx | retry with backoff |
| RequestTimeout | transient | request exceeded timeout | retry (idempotent reads) |
| ExchangeNotAvailable | transient | exchange down / maintenance | retry with longer backoff |
| DDoSProtection | transient | rate-limit / WAF rejection | back off hard, slow down |
| RateLimitExceeded | transient | explicit 429 | back off, honor retry-after |
| ExchangeError (base) | fatal | exchange rejected the request | do NOT retry |
| BadSymbol | fatal | unknown symbol | fix symbol / disable unit |
| NotSupported | fatal | method not implemented | disable that path |
| AuthenticationError | fatal | bad keys / permissions | stop, alert operator |
| InsufficientFunds | fatal | balance too low | skip order, do not retry |
| InvalidOrder | fatal | bad size/price/filter | fix or drop the order |

\`\`\`python
async def fetch_ticker_safe(exchange, symbol):
    try:
        return await exchange.fetch_ticker(symbol)
    except (ccxt.NetworkError, ccxt.RequestTimeout, ccxt.ExchangeNotAvailable,
            ccxt.DDoSProtection, ccxt.RateLimitExceeded) as e:
        raise TransientFailure(symbol, e)      # caller retries with backoff
    except ccxt.ExchangeError as e:
        raise FatalUnitError(symbol, e)        # caller disables/skips the unit
\`\`\`

The full doctrine lives in resilience-error-taxonomy; the rule here: every ccxt call site must classify its exceptions explicitly. A bare \`except Exception: return None\` erases the distinction and produces silent failures.

## RETRY / BACKOFF SKELETON

\`\`\`python
import random

async def with_retry(fn, *, retries=3, base=0.5, cap=8.0):
    for attempt in range(retries):
        try:
            return await fn()
        except TransientFailure:
            delay = min(cap, base * 2 ** attempt)
            await asyncio.sleep(delay + random.uniform(0, base))  # jitter
    raise FatalUnitError("retry budget exhausted")
\`\`\`

Budget the retries (bounded count, bounded total time). Retrying forever on a transient error is just a slower hang.

## RULES OF THUMB

- One async client per exchange, created once, closed in \`finally\`.
- \`load_markets()\` at startup, periodic \`reload=True\`, reload on unexpected \`BadSymbol\`.
- Unified symbols only; \`:\` suffix selects the settle currency for derivatives.
- Gate on \`exchange.has\`; a missing capability is fatal, not transient.
- \`enableRateLimit=True\` always; parallelism via separate instances, never by disabling the limiter.
- Classify every exception as transient or fatal at the call site; never swallow.
`,
}
