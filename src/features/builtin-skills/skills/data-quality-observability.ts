import type { BuiltinSkill } from "../types"

export const DATA_QUALITY_OBSERVABILITY_SKILL_NAME = "data-quality-observability"

const DATA_QUALITY_OBSERVABILITY_SKILL_DESCRIPTION =
  "Use when proving a market-data pipeline is alive and correct — seq-gap detection, staleness grading, ZeroMQ heartbeats, liveness monitors, and per-branch counters. Related: market-data-bus, silent-failure-detection."

export const dataQualityObservabilitySkill: BuiltinSkill = {
  name: DATA_QUALITY_OBSERVABILITY_SKILL_NAME,
  description: DATA_QUALITY_OBSERVABILITY_SKILL_DESCRIPTION,
  template: `# Data Quality Observability — Continuously Proving Liveness

A pipeline that "runs" is not a pipeline that works. This skill is about continuously PROVING that data flows: per symbol, per branch, end to end. The governing rule: **an exchange that stopped sending must not look alive anywhere** — not on Telegram, not in InfluxDB, not on the dashboard.

## SEQ-GAP DETECTION

Every price frame carries a per-symbol monotonic \`seq\` (see market-data-bus). The consumer tracks the last seq per symbol and classifies every arrival:

\`\`\`python
last_seq = {}          # symbol -> int
boot_id = {}           # symbol -> publisher boot id

def check_seq(symbol, frame):
    prev = last_seq.get(symbol)
    if prev is not None and frame["boot"] == boot_id.get(symbol):
        gap = frame["seq"] - prev
        if gap == 1:
            seq_ok.inc(symbol)
        elif gap > 1:
            seq_gaps.inc(symbol, amount=gap - 1)     # loss, counted per symbol
            logger.warning("%s lost %d frames", symbol, gap - 1)
        elif gap <= 0:
            seq_dupes.inc(symbol)                    # reorder or duplicate
    last_seq[symbol] = frame["seq"]
    boot_id[symbol] = frame["boot"]
\`\`\`

A seq reset (new publisher boot) must be distinguishable from a gap; that is why the publisher pairs seq with a boot id. A gap is a data-quality incident even if the pipeline is "up": the recorder now has a hole.

## STALENESS GRADING

Staleness = \`now - exchange_ts\` (event time at the exchange, not pub time). Map it to three states with explicit thresholds:

| State | Condition (example) | Meaning |
|---|---|---|
| healthy | age < 5s | feed current |
| warn | 5s <= age < 30s | degraded; investigate soon |
| stale | age >= 30s | feed effectively dead |

\`\`\`python
def grade(symbol, exchange_ts_ms, *, warn=5_000, stale=30_000):
    age = time.time() * 1000 - exchange_ts_ms
    if age < warn:
        freshness.labels(symbol=symbol).set(0)
    elif age < stale:
        freshness.labels(symbol=symbol).set(1)
        stale_warn.inc(symbol)
    else:
        freshness.labels(symbol=symbol).set(2)
        stale_fatal.inc(symbol)
        alert.fire("stale_feed", symbol, age_ms=age)
\`\`\`

Run the grader on a timer per symbol, not only on arrival: a feed that stops sending produces NO events, so arrival-driven checks never fire. The timer is what catches silence.

## ZMTP HEARTBEAT + PARANOID PIRATE LIVENESS

ZeroMQ sockets reconnect silently; a dead peer looks like a quiet peer. Two layers:

**Transport level (ZMTP pings):** \`zmq.HEARTBEAT_IVL\` (interval, ms), \`zmq.HEARTBEAT_TIMEOUT\` (missed-ping threshold). Set both on sockets that talk to peers which may die silently:

\`\`\`python
sock.setsockopt(zmq.HEARTBEAT_IVL, 1000)
sock.setsockopt(zmq.HEARTBEAT_TIMEOUT, 3000)
\`\`\`

**Application level (Paranoid Pirate):** peers exchange app-level heartbeat frames; liveness = 3 misses at a 1s interval; reconnect with exponential backoff 1s doubling to a 32s cap. The full worker/queue implementation lives in zeromq-reliability; the observability point is: every liveness transition (alive -> suspect -> dead -> reconnected) must increment a counter and update the exported state, so the monitor sees the peer's true state, not its last successful message.

## THE MONITOR SOCKET

pyzmq can report socket state transitions (connect/disconnect/accept) on a monitor PAIR socket:

\`\`\`python
mon = ctx.socket(zmq.PAIR)
sock.monitor("inproc://monitor.pub", zmq.EVENT_CONNECTED | zmq.EVENT_DISCONNECTED)
mon.connect("inproc://monitor.pub")

async def drain():
    while True:
        evt = await mon.recv_multipart()
        event, ep = struct.unpack("<I", evt[0][:4])[0], evt[0][4:]
        if event & zmq.EVENT_DISCONNECTED:
            socket_disconnects.inc()      # transport truth, not application truth
\`\`\`

Transport events tell you the TCP connection state. They do NOT tell you the peer's application is healthy; that is what heartbeats and staleness are for. Export both.

## PER-BRANCH COUNTERS

Every branch of every consumer increments a named counter: \`ticks_ok\`, \`seq_gaps\`, \`ws_timeout\`, \`save_errors\`, \`conflate_drops\`, \`resync_requests\`. Two uses:

1. Liveness: a healthy symbol's \`ticks_ok\` grows every interval. A flat line on any counter that should move is a finding.
2. Forensics: after an incident, the counter deltas tell you exactly which branch failed and how much was lost.

\`\`\`python
# periodic liveness sweep, timer-driven
for sym in symbols:
    if counters["ticks_ok"][sym].delta(window=60) == 0:
        alert.fire("no_ticks", sym)      # silent feed, caught by timer not by arrival
\`\`\`

## END-TO-END: ONE DEAD FEED, NO FALSE LIFES ANYWHERE

The failure that must be impossible: exchange X stops sending, but the system still shows X as alive. Prevent it by construction:

- The staleness grader's state is the SINGLE source of truth for feed health.
- Every consumer derives from that state: the Telegram bot refuses to quote a stale symbol (or prefixes it with a staleness warning), the InfluxDB writer tags points with the freshness grade, the dashboard colors the symbol from the same state.
- No consumer keeps its own "last seen" heuristic that could disagree with the grader.

\`\`\`python
# telegram side
grade_state = freshness_state[sym]
if grade_state >= STALE:
    send(f"⚠️ {sym}: feed stale ({age_s:.0f}s), last price {last_px}")
else:
    send(f"{sym}: {last_px}")
\`\`\`

## RULES OF THUMB

- seq gaps, duplicates, and resets are all counted, per symbol.
- Staleness is graded on a TIMER per symbol, from exchange_ts, with explicit thresholds.
- Heartbeat at two layers: ZMTP socket options plus app-level Paranoid Pirate (3 misses x 1s, backoff 1s to 32s).
- Monitor sockets report transport truth; heartbeats report application truth; export both.
- Every branch has a counter; a counter that should move and does not is an alarm.
- One source of truth for feed health; every sink (Telegram, InfluxDB, dashboard) derives from it.
- Silence is detected by timers, never by the absence of errors.
`,
}
