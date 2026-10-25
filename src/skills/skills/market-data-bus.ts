import type { BuiltinSkill } from "../types"

export const MARKET_DATA_BUS_SKILL_NAME = "market-data-bus"

const MARKET_DATA_BUS_SKILL_DESCRIPTION =
  "Use when designing the ZeroMQ wire contract for price distribution — snapshot+stream, seq and timestamp fields, conflation, resync commands, and topic framing. Related: zeromq-pubsub, zeromq-advanced-reqrep."

export const marketDataBusSkill: BuiltinSkill = {
  name: MARKET_DATA_BUS_SKILL_NAME,
  description: MARKET_DATA_BUS_SKILL_DESCRIPTION,
  template: `# Market Data Bus — Wire Contract over ZeroMQ

This skill defines the DOMAIN contract layered on top of generic ZeroMQ patterns. Socket types, HWM, LINGER, and PUB/SUB mechanics are covered by zeromq-pubsub and zeromq-advanced-reqrep; read those first. Here: what goes ON the wire for prices.

## SNAPSHOT + STREAM

PUB/SUB drops early messages for late joiners (subscriptions take effect asynchronously). Never stream alone. Pair a PUB stream with a snapshot source:

1. Subscriber connects SUB to the stream and REQ/DEALER to the snapshot service.
2. Subscriber SUBSCRIBES FIRST, then requests the snapshot.
3. Snapshot service sends the current state, then a boundary marker.
4. Subscriber applies stream updates only after the boundary, discarding stream messages older than the snapshot.

\`\`\`python
# subscriber
sub.setsockopt(zmq.SUBSCRIBE, b"prices ")
sub.connect("tcp://broadcaster:5556")
snap = ctx.socket(zmq.REQ)
snap.connect("tcp://snapshotter:5557")
time.sleep(0.2)                      # let the subscription propagate
snap.send(b"snapshot")
while True:
    msg = snap.recv_multipart()
    if msg[0] == b"END":             # boundary marker
        break
    apply_snapshot(msg)
# now consume the live stream
\`\`\`

## EVERY PRICE CARRIES: seq, exchange_ts, pub_ts

Every published price message carries three fields:

| Field | Meaning | Set by |
|---|---|---|
| \`seq\` | per-symbol monotonic sequence number, incremented by the publisher | publisher |
| \`exchange_ts\` | event time AT THE EXCHANGE (ms epoch) | exchange data |
| \`pub_ts\` | time the publisher emitted the frame | publisher |

\`seq\` detects loss and reordering per symbol: a subscriber seeing seq 41 after 39 knows 40 was lost (or the publisher restarted; a seq reset must be detectable, e.g. by pairing with a publisher boot id). \`exchange_ts\` drives staleness (now - exchange_ts). \`pub_ts\` separates publisher lag from exchange lag. Without all three you cannot tell "exchange is slow" from "my bus is slow" from "frames were dropped".

\`\`\`python
# publisher side
seq[symbol] += 1
frame = orjson.dumps({
    "sym": symbol, "px": price, "qty": qty,
    "seq": seq[symbol],
    "ets": exchange_ts, "pts": now_ms(),
})
pub.send_multipart([b"prices " + symbol.encode(), frame])
\`\`\`

## CONFLATION: TWO CONSUMERS, TWO SETTINGS

Conflation (zmq.CONFLATE=1) keeps only the LAST frame in the receive queue. It is a per-socket option, set BEFORE connect, and it works ONLY on sockets receiving single-frame messages. Multipart frames defeat it.

- Recorder / anything needing full history: \`conflate=False\` (default). Every tick matters; loss is a data-quality incident.
- Latest-price UI / dashboard: \`conflate=True\`. Only the newest price matters; a queue full of stale ticks is waste.

\`\`\`python
ui = ctx.socket(zmq.SUB)
ui.setsockopt(zmq.CONFLATE, 1)       # BEFORE connect; single-frame messages only
ui.setsockopt(zmq.SUBSCRIBE, b"prices ")
ui.connect("tcp://broadcaster:5556")
\`\`\`

If you need conflation AND topic framing, put the topic INSIDE the single payload frame (e.g. JSON with a "topic" field) instead of multipart.

## RESYNC VIA A COMMAND CHANNEL

When a subscriber detects a seq gap or unrecoverable staleness, it must be able to demand a fresh snapshot. Run a command channel alongside the stream: DEALER on the subscriber, ROUTER on the bus control service, with correlation ids so replies match requests (the envelope mechanics are zeromq-advanced-reqrep's territory).

\`\`\`python
# subscriber detects gap
if expected_seq is not None and frame["seq"] != expected_seq + 1:
    gaps.inc(symbol)
    cmd.send_multipart([corr_id, orjson.dumps(
        {"op": "resync", "sym": symbol, "last_seq": expected_seq})])
    # control service replies with a fresh snapshot for that symbol,
    # tagged with the same corr_id
\`\`\`

Commands the control channel should support: \`resync\` (snapshot for one symbol), \`status\` (publisher liveness, per-symbol last seq), \`kill\` (admin stop). Correlation ids make replies routable even with several in-flight requests.

## TOPIC FRAMING

For the recorder (no conflation), use multipart topic framing: frame 0 = topic (\`b"prices " + symbol\`), frame 1 = payload. SUBSCRIBE filters on the topic prefix, so a consumer can take one symbol or all. Remember the trailing space convention (\`b"prices "\`) to avoid prefix collisions like \`BTC\` matching \`BTC2\`.

## SERIALIZATION CHOICE

| Format | Speed | Size | When |
|---|---|---|---|
| json (stdlib) | slow | fat | never on the hot path |
| orjson | very fast | compact | default for JSON payloads |
| msgpack | fast | compact | cross-language, schema-light |

\`\`\`python
import orjson
payload = orjson.dumps(frame)                 # encode
frame = orjson.loads(raw)                     # decode; orjson.loads accepts bytes
\`\`\`

Pick ONE format per channel and document it. Mixed formats on one topic is a debugging tax. orjson is the default: it is the fastest JSON and its \`loads\` takes bytes directly.

## RULES OF THUMB

- Snapshot + stream, subscribe-before-snapshot, boundary marker before applying live updates.
- seq + exchange_ts + pub_ts on every price frame; seq is per-symbol and monotonic.
- conflate=True only for latest-value consumers, single-frame messages, set before connect.
- Resync is a command, not a hope: DEALER/ROUTER control channel with correlation ids.
- One serialization format per channel; orjson by default.
- Generic ZeroMQ mechanics (HWM, LINGER, socket types, envelopes) live in the zeromq-* skills.
`,
}
