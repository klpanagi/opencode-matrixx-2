import type { BuiltinSkill } from "../types"

export const TELEGRAM_BOT_SKILL_NAME = "telegram-bot"

const TELEGRAM_BOT_SKILL_DESCRIPTION =
  "Use when building a Telegram operator bot for a trading or market-data system, designing bot commands, or wiring authorization and rate limits — async python-telegram-bot control plane routed over the message bus, never direct exchange access. Related: market-data-bus, zeromq-advanced-reqrep."

export const telegramBotSkill: BuiltinSkill = {
  name: TELEGRAM_BOT_SKILL_NAME,
  description: TELEGRAM_BOT_SKILL_DESCRIPTION,
  template: `# Telegram Bot as Operator Control Plane

## THE ONE RULE: NO EXCHANGE ACCESS

The bot is a control plane, not a data plane. It MUST NOT hold exchange API keys, call ccxt, or open websockets to exchanges. Every data read and every action goes over the message bus:

- Reads (latest price, staleness): the bot SUBscribes to the price PUB socket and keeps only the LATEST message per series (conflation). It never polls exchanges.
- Commands (add pair, set alert, pause feed): the bot sends a DEALER request to the price publisher's ROUTER and waits for an ack. The publisher owns all exchange I/O.

Why: the bot is internet-facing. If it is compromised, the blast radius is "someone can send messages on my internal bus", not "someone has my exchange keys". It also keeps the bot trivially restartable.

\`\`\`python
# Python (pyzmq): bot-side bus wiring
import zmq, zmq.asyncio

ctx = zmq.asyncio.Context()  # one context per process

sub = ctx.socket(zmq.SUB)
sub.setsockopt(zmq.SUBSCRIBE, b"prices ")
sub.connect("tcp://publisher:5556")          # PUB for data

dealer = ctx.socket(zmq.DEALER)
dealer.setsockopt(zmq.IDENTITY, b"telegram-bot")
dealer.connect("tcp://publisher:5555")       # ROUTER for commands
\`\`\`

## ASYNC HANDLERS (python-telegram-bot)

\`\`\`python
# Python (python-telegram-bot v20+, async)
from telegram.ext import Application, CommandHandler, filters

async def cmd_price(update, context):
    user = update.effective_user
    if not auth.allow(user.id):
        await update.message.reply_text("not authorized")
        return
    if not rate_limit.allow(user.id, "price", per_minute=10):
        await update.message.reply_text("slow down")
        return
    symbol = context.args[0] if context.args else None
    if symbol is None:
        await update.message.reply_text("usage: /price SYMBOL")
        return
    latest = latest_cache.get(symbol)   # from SUB conflation, never an exchange call
    if latest is None:
        await update.message.reply_text(f"no data for {symbol}")
        return
    await update.message.reply_text(f"{symbol} {latest['exchange']}: {latest['price']}")

app = Application.builder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler("price", cmd_price))
app.run_polling()
\`\`\`

aiogram 3 works equally well (\`Dispatcher\`, \`@router.message(Command("price"))\`). Pick one; both are asyncio-native and coexist with pyzmq's asyncio sockets in one loop.

## AUTHORIZATION ALLOWLIST

Every handler checks the allowlist FIRST, before doing anything:

\`\`\`python
# Python: allowlist from config, never hardcoded
ALLOWED_USERS = {int(x) for x in os.environ["BOT_ALLOWED_USERS"].split(",")}

def allow(user_id: int) -> bool:
    return user_id in ALLOWED_USERS
\`\`\`

- Key on numeric user ID, not username (usernames change).
- Log every denied attempt with the user ID. Repeated denials are a security signal.
- Group chats: restrict the bot to private chats unless you have a reason; group membership leaks command traffic.

## NEVER ECHO SECRETS

- The bot token, exchange keys, and Influx tokens never appear in bot output, error messages, or /status dumps.
- Error handlers must sanitize: catch exceptions and reply with a fixed message plus a correlation ID, never the traceback (tracebacks can contain env values).
- \`/status\` shows operational state (feed health, staleness, queue depth), never credentials or URLs with tokens.

\`\`\`python
# Python: safe error handler
async def on_error(update, context):
    corr = uuid4().hex[:8]
    logger.exception("bot error corr=%s", corr)   # full detail to logs only
    if update and update.effective_message:
        await update.effective_message.reply_text(f"internal error, corr={corr}")
\`\`\`

## IDEMPOTENT OPERATIONS

Telegram retries deliveries; users double-tap. Every mutating command must be idempotent:

- \`/addpair BTC/USDT\` twice = one pair added (publisher dedupes on the pair key and acks both).
- \`/setalert\` with identical arguments replaces the existing alert for that (symbol, exchange, direction) key instead of stacking a duplicate.
- Include a client-generated request ID in bus commands so the publisher can dedupe across retries.

## PER-USER RATE LIMITS

A token-bucket per user per command class. Without it, one operator's script can flood the bus and the chat:

\`\`\`python
# Python: simple sliding-window limiter
from collections import defaultdict, deque
import time

windows = defaultdict(deque)

def allow(user_id: int, cmd: str, per_minute: int) -> bool:
    now = time.monotonic()
    q = windows[(user_id, cmd)]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        return False
    q.append(now)
    return True
\`\`\`

## STATEFUL COMMANDS: PERSISTENCE

Alerts, watchlists, and settings must survive bot restarts. Persist to a small store (SQLite or JSON file with atomic writes) keyed by user:

\`\`\`python
# Python: alert record shape
{
  "id": "a1b2c3",
  "user_id": 12345,
  "symbol": "BTC/USDT:USDT",
  "exchange": "binance",
  "direction": "above",       # above | below
  "price": 65000.0,
  "mode": "once",             # once | repeat | cooldown
  "cooldown_s": 3600,         # for cooldown mode
  "created_ts": 1728648000000000000,
  "last_fired_ts": null
}
\`\`\`

On startup, reload alerts and re-register them with the alerting component over the bus. The bot is stateless between restarts except for this file.

## COMMAND UX

\`\`\`
/setalert <symbol> <exchange> <above|below> <price> [once|repeat|cooldown]
  /setalert BTC/USDT:USDT binance above 65000 once
  /setalert ETH/USDT bybit below 2200 cooldown
/addpair <symbol> [exchange]        -> routed to publisher over DEALER->ROUTER
/rmpair <symbol> [exchange]
/price <symbol>                     -> from latest-only SUB cache
/status                             -> feed health, staleness states, queue depth
/alerts                             -> list my alerts
/delalert <id>
\`\`\`

- Validate arguments in the bot (symbol format, price is a float) before sending anything on the bus; the publisher acks with an error if the pair is unknown, and the bot relays that verbatim.
- \`once\` fires and deletes; \`repeat\` fires every check; \`cooldown\` re-fires no more than once per cooldown window.
- Confirm every mutation with the resulting state ("alert a1b2c3 set: BTC/USDT:USDT binance above 65000, once"), so users can verify idempotency.

## LATEST-ONLY CONFLATION FOR READS

The bot's SUB socket receives every tick. Keep only the newest per (exchange, market_type, symbol) and drain the socket non-blockingly so it never lags:

\`\`\`python
# Python: drain + conflate in the bot's read loop
async def price_reader():
    latest = {}
    while True:
        try:
            while True:                       # drain everything pending
                topic, payload = await sub.recv_multipart(zmq.NOBLOCK)
                msg = json.loads(payload)
                key = (msg["exchange"], msg["market_type"], msg["symbol"])
                latest[key] = msg             # newest wins
        except zmq.Again:
            pass
        await asyncio.sleep(0.2)
\`\`\`

The bot does not need tick history; it needs the current truth. History lives in InfluxDB (see influxdb-timeseries).

## ANTI-PATTERNS

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Bot holds exchange keys | Internet-facing process with trading credentials | All exchange I/O in the publisher; bot talks bus only |
| Blocking sync handlers | Bot freezes under load | Async handlers, asyncio loop |
| No allowlist | Anyone who finds the bot controls your system | User-ID allowlist, log denials |
| Tracebacks in replies | Leaks env values | Fixed message + correlation ID |
| Non-idempotent /addpair | Telegram retries duplicate pairs | Dedupe keys + request IDs |
| Bot polls exchanges for /price | Rate limits, latency, duplicate I/O owner | SUB conflation, latest-only cache |
| In-memory alerts only | Restart loses every alert | Persisted alert store, reload on boot |
`,
}
