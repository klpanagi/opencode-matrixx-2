import type { BuiltinSkill } from "../types"

export const MARKET_DATA_ARCHITECTURE_SKILL_NAME = "market-data-architecture"

const MARKET_DATA_ARCHITECTURE_SKILL_DESCRIPTION =
  "Use when designing or reviewing a market-data pipeline, price publisher, or trading-data topology — the canonical reference architecture with 9 robustness invariants: snapshot+stream, seq gaps, staleness, error taxonomy, backpressure, isolation, scale, UTC-ns, no silent failure. Related: market-data-bus, data-quality-observability."

export const marketDataArchitectureSkill: BuiltinSkill = {
  name: MARKET_DATA_ARCHITECTURE_SKILL_NAME,
  description: MARKET_DATA_ARCHITECTURE_SKILL_DESCRIPTION,
  template: `# Market-Data Pipeline: The Canonical Reference Architecture

## THE PIPELINE

One publisher owns ALL exchange I/O. Everything else is a consumer or a command sender.

\`\`\`
                    OWNS ALL EXCHANGE I/O
┌─────────────────────────────────────────────────────────┐
│ price_publisher                                         │
│   ccxt.pro websockets (live ticks)                      │
│   + REST snapshot on startup / reconnect (catch-up)     │
│   → normalise (unified symbols, UTC-ns, None for absent)│
│   → ZMQ PUB  [topic, payload{seq, exchange_ts, pub_ts}] │
└───────────────┬─────────────────────────┬───────────────┘
                │ tcp://*:5556 (PUB)      │ tcp://*:5555 (ROUTER)
                ▼                         ▼
   ┌────────────────────────┐   ┌──────────────────────────┐
   │ telegram_bot (SUB)     │   │ recorder (SUB)           │
   │  latest-only conflate  │   │  conflate=False          │
   │  commands: DEALER →    │   │  → InfluxDB (batched)    │
   │  ROUTER back to pub    │   │  → Grafana reads it      │
   └────────────────────────┘   └──────────────────────────┘
\`\`\`

Key properties:

- **price_publisher**: the ONLY process with exchange API keys and sockets. REST snapshot + WS stream (invariant 1). Publishes every tick with a per-symbol \`seq\`, the exchange's \`exchange_ts\`, and its own \`pub_ts\`.
- **telegram_bot**: SUBscribes, conflates to latest-only per series, serves /price from that cache. Sends commands (addpair, setalert) via DEALER to the publisher's ROUTER. Holds NO exchange access.
- **recorder**: SUBscribes with \`conflate=False\` (every tick matters), writes batched points to InfluxDB with explicit UTC-ns \`Point.time\`, and computes/publishes staleness states for Grafana.

Message envelope (the contract every consumer relies on):

\`\`\`json
{
  "seq": 1042,
  "exchange_ts": 1728648000123456789,
  "pub_ts": 1728648000156789012,
  "exchange": "binance",
  "market_type": "perp",
  "symbol": "BTC/USDT:USDT",
  "last": 64950.5,
  "bid": 64950.0,
  "ask": 64951.0
}
\`\`\`

Topic format: \`prices <exchange> <market_type> <symbol>\` (space-separated, SUB prefix filtering works).

## THE 9 NON-NEGOTIABLE ROBUSTNESS INVARIANTS

These are RUNTIME properties. Code and tests must satisfy them; a pipeline that violates any of them is broken regardless of how clean it looks.

### 1. Snapshot + stream

A websocket alone loses everything between connect and first tick, and everything during a reconnect. On startup and after every reconnect, the publisher fetches a REST snapshot and THEN subscribes, publishing the snapshot first so consumers start from truth. Snapshot-then-stream ordering must be enforced (buffer stream ticks until the snapshot is applied, or drop pre-snapshot stream ticks for symbols the snapshot covers).

### 2. Per-symbol sequence numbers and gap detection

Every published message carries \`seq\`, monotonic per (exchange, market_type, symbol). Consumers detect gaps:

\`\`\`python
# Python: consumer-side gap detection
expected = state.get(key, {}).get("next_seq")
if expected is not None and msg["seq"] > expected:
    logger.warning("gap on %s: expected seq %d, got %d (%d lost)",
                   key, expected, msg["seq"], msg["seq"] - expected)
    metrics.gaps.inc()
state[key] = {"next_seq": msg["seq"] + 1}
\`\`\`

Gaps are a first-class signal: they mean data was lost between publisher and consumer (HWM drops, restart, slow joiner). Never silently accept them.

### 3. Staleness thresholds

Per series, track the age of the last message against the EXPECTED interval for that series (tickers ~1s, funding ~minutes). Three states:

| State | Condition | Meaning |
|---|---|---|
| healthy | age <= 2x interval | normal |
| warn | age > 2x interval | degraded; investigate soon |
| stale | age > 5x interval | feed effectively dead; alert |

The recorder publishes staleness states (measurement \`staleness\`, field \`state\`, values 0/1/2) so Grafana and the bot can surface them. Thresholds must be identical everywhere they are evaluated.

### 4. Error taxonomy: transient vs fatal

Classify every error at the point it happens:

- **Transient** (retry with backoff): network blips, websocket 1006 drops, HTTP 429/503, DNS hiccups, InfluxDB write timeouts. Retry, count, keep running.
- **Fatal** (skip the series or the exchange, alert): symbol delisted (\`active: false\`), invalid API key, unsupported market type, unrecoverable auth. Retrying forever hides the problem; skip and surface it.

\`\`\`python
# Python: taxonomy at the boundary
try:
    await pump_symbol(symbol)
except ccxt.NetworkError as e:
    retry_with_backoff(symbol, e)          # transient
except ccxt.BadSymbol as e:
    skip_series(symbol, reason=str(e))     # fatal: do not retry
    notify_operator(symbol, e)
\`\`\`

### 5. Explicit backpressure / drop policy

Every queue and socket has a declared policy. ZeroMQ PUB/SUB drops at HWM by default; that is a POLICY, so state it and instrument it:

- Publisher: set SNDHWM deliberately; count drops if the transport exposes them; prefer dropping OLD ticks over blocking the exchange pump.
- Recorder: if the InfluxDB batch queue fills, drop oldest and increment a counter. Never block the SUB drain loop.
- Bot: latest-only conflation IS the drop policy (only the newest tick matters).
- Every drop increments a metric. A drop that is not counted is a silent failure (invariant 9).

### 6. Process isolation: one ZMQ context per process

- ONE \`zmq.Context()\` per process, created at the top and shared by all threads in that process. Never per-socket, never per-thread.
- Each consumer is a separate PROCESS. A stalling consumer (blocked InfluxDB, hung bot) fills only its own queues; it can never block another consumer or the publisher. This is why the recorder and the bot are separate processes, not threads of one app.
- The publisher never awaits a consumer. PUB is fire-and-forget; commands arrive on ROUTER and are handled without blocking the pump loop.

### 7. Scalability levers

Grow along these axes when load demands it; do not redesign:

- **Per-exchange supervisors**: one task (or process) per exchange, each with its own reconnect/backoff loop. One exchange's outage costs nothing to the others (see crypto-market-structure).
- **Dynamic subscriptions**: the publisher accepts add/remove-pair commands at runtime (DEALER->ROUTER); new symbols start streaming without a restart.
- **Horizontal consumers**: SUB sockets fan out naturally; add recorder replicas, additional bots, or analytics consumers without touching the publisher. For fan-out beyond one PUB socket, add XPUB/XSUB proxy stages.

### 8. UTC-nanosecond timestamps, end to end

- \`exchange_ts\`: the exchange's event time, converted to UTC nanoseconds. This is the time InfluxDB stores (\`Point.time\`).
- \`pub_ts\`: the publisher's own UTC-ns clock at publish time. The DELTA between them is your pipeline lag; monitor it.
- No local naive datetimes anywhere. No server-side InfluxDB timestamps. See influxdb-timeseries and time-series-fundamentals.

### 9. No silent failure

Every failure path ends in an observable signal: a log line with context, a metric, a staleness state, or a bot message. Concretely:

- InfluxDB writes pass \`on_error\` callbacks; failed batches are dead-lettered.
- Gap detection increments counters and logs.
- Staleness transitions are published, not just computed.
- The bot's /status reads these signals; an operator must be able to see ANY degradation without reading code.
- The inverse rule: if a failure produces no log, metric, or state change, it does not exist, and someone will discover it as "why is the chart empty since Tuesday".

## PLUGIN-VS-RUNTIME BOUNDARY

This skill (and the Matrixx plugin that ships it) injects KNOWLEDGE and lints diffs. It does not run your pipeline. The invariants above are runtime properties that YOUR code and YOUR tests must satisfy:

- Tests assert seq continuity, staleness transitions, snapshot-before-stream ordering, and error-taxonomy behavior.
- The plugin's job: when you ask an agent to build or modify pipeline code, the agent knows these invariants and writes code (and tests) that honor them. It can also flag diffs that violate them (e.g. server-side timestamps, missing on_error, blocking consumer loops).
- Nothing in the plugin executes exchanges, holds keys, or runs ZMQ at runtime.

## DESIGN REVIEW CHECKLIST

1. Who owns exchange I/O? Exactly one component (the publisher).
2. Snapshot before stream on every (re)connect?
3. \`seq\` on every message, gaps detected and counted per symbol?
4. Staleness states computed and published with 2x/5x thresholds?
5. Every error classified transient (retry) or fatal (skip+alert)?
6. Every queue/socket has a written drop policy and a drop metric?
7. One ZMQ context per process; consumers are separate processes?
8. \`exchange_ts\` + \`pub_ts\` UTC-ns on every message; lag monitored?
9. Can every failure be SEEN from /status or Grafana without reading code?
`,
}
