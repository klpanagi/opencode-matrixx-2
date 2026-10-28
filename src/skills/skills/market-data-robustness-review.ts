import type { BuiltinSkill } from "../types"

export const MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_NAME = "market-data-robustness-review"

const MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_DESCRIPTION =
  "Use when reviewing a market-data pipeline against robustness invariants -- 9-point checklist (snapshot+stream, seq gaps, staleness, taxonomy, backpressure, isolation, scale, UTC-ns, no silent failure), envelope and backpressure/scale guidance. Related: market-data-architecture, data-quality-observability."

export const marketDataRobustnessReviewSkill: BuiltinSkill = {
  name: MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_NAME,
  description: MARKET_DATA_ROBUSTNESS_REVIEW_SKILL_DESCRIPTION,
  template: `# Market-Data Robustness Review -- The 9-Invariant Checklist

A review checklist derived from the neo reviewer role. Walk each invariant in order, cite file+line evidence for each verdict, and report findings as a prose checklist -- no JSON verdict required. For the canonical topology and deep rationale, see market-data-architecture; for counters, reconciliation, and dashboards, see data-quality-observability.

## Message envelope (the contract every consumer relies on)

Every published tick carries per-symbol seq, exchange_ts (UTC-ns event time), pub_ts (UTC-ns publish time), exchange, market_type, symbol, and quote fields. Topic format: prices <exchange> <market_type> <symbol>. Consumers rely on seq for gap detection and on the exchange_ts/pub_ts delta for lag monitoring.

## The 9 invariants -- what to verify

### 1. Snapshot + stream
Verify the publisher fetches a REST snapshot on startup and after every reconnect and publishes it BEFORE subscribing to the stream (buffer or drop pre-snapshot ticks). Evidence: snapshot call site, ordering logic, reconnect path.

### 2. Per-symbol sequence numbers and gap detection
Verify every message carries a monotonic seq per (exchange, market_type, symbol) and consumers detect, log, and count gaps. Evidence: seq assignment, next_seq tracking, gap counters.

### 3. Staleness thresholds
Verify per-series last-update age is tracked against the expected interval with warn (>2x) and stale (>5x) states, published so operators can see them. Evidence: staleness computation, published states, uniform thresholds.

### 4. Error taxonomy: transient vs fatal
Verify every external call classifies failures as transient (retry with bounded backoff+jitter) versus fatal (skip+alert, no retry), explicitly at the boundary. Evidence: taxonomy branches, retry bounds.

### 5. Explicit backpressure / drop policy
Verify every queue and socket declares its slow-consumer policy: conflate, bounded queue, drop-oldest-with-counter, or block -- and every drop increments a metric. Evidence: HWM settings, queue bounds, drop counters.

### 6. Process isolation
Verify exchange I/O, recording, and command serving live in separate processes sharing one ZMQ context per process; the publisher never awaits a consumer. Evidence: process layout, context creation, fire-and-forget PUB.

### 7. Scalability levers
Verify growth happens via per-exchange supervisors, runtime add/remove-pair commands, and horizontal SUB fan-out (XPUB/XSUB proxies) -- never by growing a single process unboundedly.

### 8. UTC-nanosecond timestamps, end to end
Verify exchange_ts and pub_ts are explicit UTC nanoseconds on every message, stored points carry explicit Point.time, and lag (pub_ts - exchange_ts) is monitored.

### 9. No silent failure
Verify every failure path ends in an observable signal: log with context, metric, staleness state, or operator message -- checkable from /status or Grafana without reading code.

## Backpressure / scale guidance

Prefer dropping OLD ticks over blocking the exchange pump; the recorder never blocks its SUB drain loop; latest-only conflation is the bot drop policy. Scale along supervisors, dynamic subscriptions, and consumer fan-out; do not redesign under load.

## Review checklist

- [ ] Snapshot before stream on every (re)connect?
- [ ] seq on every message, gaps detected and counted per symbol?
- [ ] Staleness states computed and published with 2x/5x thresholds?
- [ ] Every error classified transient (retry) or fatal (skip+alert)?
- [ ] Every queue/socket has a written drop policy and a drop metric?
- [ ] One ZMQ context per process; consumers are separate processes?
- [ ] Topology scales via supervisors, dynamic subs, fan-out?
- [ ] exchange_ts + pub_ts UTC-ns on every message; lag monitored?
- [ ] Can every failure be SEEN from /status or Grafana without reading code?

Related: market-data-architecture, data-quality-observability.
`,
}
