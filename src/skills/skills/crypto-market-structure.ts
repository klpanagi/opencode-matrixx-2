import type { BuiltinSkill } from "../types"

export const CRYPTO_MARKET_STRUCTURE_SKILL_NAME = "crypto-market-structure"

const CRYPTO_MARKET_STRUCTURE_SKILL_DESCRIPTION =
  "Use when handling ccxt market metadata, spot vs perpetual symbols, funding rates, or basis calculations — the unified market model across exchanges: symbol formats, market types, mark vs last price, and per-exchange quirks. Related: ccxt-rest, market-data-architecture."

export const cryptoMarketStructureSkill: BuiltinSkill = {
  name: CRYPTO_MARKET_STRUCTURE_SKILL_NAME,
  description: CRYPTO_MARKET_STRUCTURE_SKILL_DESCRIPTION,
  template: `# Crypto Market Structure for Market-Data Engineering

## THE UNIFIED MODEL: SPOT VS PERPETUAL

One asset trades in several distinct markets. A market-data pipeline must model them explicitly or charts and alerts silently mix them.

- **Spot**: immediate delivery. Symbol \`BTC/USDT\`. You own the coin.
- **Perpetual future**: no expiry, kept near spot by funding payments. Symbol \`BTC/USDT:USDT\` in ccxt's unified format, where the suffix after \`:\` is the SETTLEMENT currency.
- **Linear perp**: settled in a quote currency (USDT). \`BTC/USDT:USDT\`. PnL in USDT. The default for most traders.
- **Inverse perp**: settled in the base currency. \`BTC/USD:BTC\`. PnL in BTC, convexity flips. Fewer exchanges offer it (BitMEX, Bybit inverse).
- **Dated futures**: \`BTC/USDT:USDT-240927\` style, expiry in the symbol.

The \`/USDT\` part is the pair; the \`:USDT\` suffix is the settlement. \`BTC/USDT\` and \`BTC/USDT:USDT\` are DIFFERENT markets with different prices, and their difference is the basis.

## THE market[] STRUCTURE

ccxt's \`exchange.load_markets()\` returns a dict keyed by unified symbol. The fields that drive pipeline decisions:

| Field | Values | Meaning |
|---|---|---|
| \`type\` | \`spot\`, \`swap\`, \`future\`, \`option\` | contract class |
| \`linear\` | \`true\`/\`false\`/\`None\` | linear (quote-settled) vs inverse; None for spot |
| \`spot\` | bool | is a spot market |
| \`swap\` | bool | is a perpetual |
| \`active\` | bool | tradable right now |
| \`symbol\` | \`BTC/USDT:USDT\` | unified key; use THIS, not \`id\` |
| \`id\` | \`BTCUSDT\`, \`BTC-USDT-SWAP\` | exchange-native; never persist as the primary key |
| \`settle\` | \`USDT\`, \`BTC\` | settlement currency |
| \`contractSize\` | float | multiplier for inverse contracts |

\`\`\`python
# Python (ccxt): classify markets
import ccxt

ex = ccxt.binanceusdm({"enableRateLimit": True})
markets = ex.load_markets()

for symbol, m in markets.items():
    if not m.get("active", False):
        continue
    if m.get("swap") and m.get("linear"):
        print(symbol, "linear perp", "settle:", m["settle"])
    elif m.get("spot"):
        print(symbol, "spot")
\`\`\`

Always key internal state by the unified \`symbol\`. Exchange-native \`id\`s differ per venue (\`BTC-USDT-SWAP\` on OKX, \`BTCUSDT_UMCBL\` historically on Bitget) and leak exchange specifics into every consumer.

## FUNDING RATE AND BASIS

- **Funding rate**: periodic payment between longs and shorts that pins a perp to spot. Positive = longs pay shorts (perp trades above spot, market long-biased). Exchanges publish the CURRENT rate and the NEXT rate; they change on a schedule (usually every 8h, some 1h or 4h).
- **Basis** = perp price minus spot price (for the same asset, same exchange ideally). It is the market's read of funding pressure. Persist both legs so basis is computable later; do not persist only the perp.
- **Mark price vs last price**:
  - \`last\`: the last traded price on that market. Noisy, gappable.
  - \`mark\`: an index-derived price (often spot index + basis smoothing) used for liquidations and unrealized PnL. Smoother, always present for perps even when the order book is thin.
  - Alerts and staleness on perps should generally use mark or last consistently and SAY which one; mixing them makes basis charts lie.

\`\`\`python
# Python (ccxt.pro): perp ticker carries both
ticker = await exchange.watch_ticker("BTC/USDT:USDT")
# ticker["last"]   -> last traded
# ticker["mark"]   -> mark price (perps; may be absent on some exchanges)
# funding: await exchange.watch_funding_rate("BTC/USDT:USDT") where supported
\`\`\`

## FIELD ABSENCE IS NORMAL

Ticker fields are OPTIONAL per exchange and per market state. \`bid\`/\`ask\` can be None on a one-sided book; \`mark\` is absent on spot; \`last\` can be None for a never-traded listing. The pipeline contract:

- Treat every field as possibly missing. Write what exists; skip what does not. Do NOT write 0.0 for a missing bid (that fabricates data; see time-series-fundamentals).
- Normalize at the publisher: one internal message shape with \`None\` for absent fields, so consumers never learn per-exchange quirks.

\`\`\`python
# Python: defensive normalization
def normalize(tick, exchange, market_type, symbol):
    return {
        "exchange": exchange,
        "market_type": market_type,
        "symbol": symbol,
        "last": tick.get("last"),
        "bid": tick.get("bid"),
        "ask": tick.get("ask"),
        "exchange_ts": tick.get("timestamp"),  # may be None; publisher must then stamp its own UTC time
    }
\`\`\`

## PER-EXCHANGE QUIRKS (PATTERN, NOT EXHAUSTIVE LIST)

- Symbol suffixes differ: Binance perps are \`BTC/USDT:USDT\`; OKX swaps are \`BTC/USDT:USDT\` too but their native ids are \`BTC-USDT-SWAP\`; some exchanges expose dated futures with different suffix conventions.
- Some exchanges list the same asset under both linear and inverse perps; both are valid markets and both may need recording.
- Rate limits, ticker granularity, and whether \`watch_ticker\` pushes deltas or full snapshots vary; the publisher absorbs this, consumers never see it.
- Delisted or inactive markets appear in \`load_markets()\` with \`active: false\`; filter them at subscription time.

## ISOLATION RULE: ONE EXCHANGE'S GAP MUST NOT TOUCH OTHERS

A symbol one exchange does not list (or has delisted, or rate-limits you on) is that exchange's problem:

- Subscription config is per (exchange, market_type, symbol). A failed subscription on Binance must not cancel the Bybit subscription for the same symbol.
- Staleness is tracked per series, not per pipeline: Binance BTC/USDT going stale must not mark Bybit BTC/USDT stale.
- Errors from one exchange's websocket must not crash a shared loop that also serves other exchanges; supervise per exchange (see market-data-architecture invariant 7).

\`\`\`python
# Python: per-exchange isolation sketch
async def run_exchange(name, symbols):
    ex = getattr(ccxt.pro, name)({"enableRateLimit": True})
    while True:
        try:
            await subscribe_and_pump(ex, symbols)   # owns only this exchange
        except Exception as e:
            logger.error("exchange %s feed died: %s; restarting", name, e)
            await asyncio.sleep(5)                  # other exchanges keep running
\`\`\`

## CHECKLIST

1. Unified symbols everywhere internally; \`id\` only at the exchange boundary.
2. \`market_type\` (spot/perp) is a first-class tag in storage; never infer it from the symbol alone.
3. Linear vs inverse recorded when both exist for an asset.
4. Mark vs last chosen deliberately per consumer and labeled.
5. Every ticker field treated as optional; missing is missing, not zero.
6. Per-exchange isolation for subscriptions, staleness, and error handling.
`,
}
