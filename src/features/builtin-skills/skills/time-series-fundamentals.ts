import type { BuiltinSkill } from "../types"

export const TIME_SERIES_FUNDAMENTALS_SKILL_NAME = "time-series-fundamentals"

const TIME_SERIES_FUNDAMENTALS_SKILL_DESCRIPTION =
  "Use when reasoning about tick vs bar data, resampling, gaps, retention, or timestamps in any time-series system — sampling versus event-data semantics for market data, with the never-fabricate-a-point rule. Related: influxdb-timeseries, crypto-market-structure."

export const timeSeriesFundamentalsSkill: BuiltinSkill = {
  name: TIME_SERIES_FUNDAMENTALS_SKILL_NAME,
  description: TIME_SERIES_FUNDAMENTALS_SKILL_DESCRIPTION,
  template: `# Time-Series Fundamentals for Market Data

## EVENT DATA VS SAMPLED DATA

Market data is EVENT data: a tick exists because something happened (a trade, a quote update). Most analysis tools assume SAMPLED data: one value per fixed interval. Confusing the two is the root of most time-series bugs.

| Property | Event data (ticks) | Sampled data (bars) |
|---|---|---|
| Exists when | something happened | the clock ticked |
| Spacing | irregular | regular |
| A quiet period means | no points (a real gap) | a flat or null value |
| Storage | one point per event | one point per bucket |
| Aggregation | lossy (must choose) | lossless within bucket |

A tick stream with no trades for 10 minutes has NO points for 10 minutes. That is correct. A 1-minute bar stream has a bar every minute, even if volume is zero. Both are valid; they answer different questions.

## TICK VS BAR/OHLCV

- **Tick**: the raw event. Fields: price, bid, ask, size, exchange timestamp. Highest fidelity, highest volume.
- **Bar/OHLCV**: a bucket over an interval (1m, 5m, 1h): open (first tick), high, low, close (last tick), volume (sum). Bars are DERIVED. Never store bars as if they were observations without recording the bucket boundaries.
- Exchange-provided klines are the exchange's own bucketing; your own resampling from ticks may differ slightly (bucket alignment, trade-time vs receive-time). Do not mix them in one series.

\`\`\`python
# Python: resampling ticks to 1m bars with pandas
import pandas as pd

df = pd.DataFrame(ticks)  # columns: price, size, exchange_ts (UTC datetime index)
bars = df.resample("1min", label="left", closed="left").agg(
    open=("price", "first"),
    high=("price", "max"),
    low=("price", "min"),
    close=("price", "last"),
    volume=("size", "sum"),
)
bars = bars.dropna(subset=["open"])  # buckets with NO ticks are dropped, not filled
\`\`\`

## ALIGNMENT AND RESAMPLING

- Choose the bucket edge convention and keep it: \`label="left", closed="left"\` means the 10:00 bar covers [10:00:00, 10:01:00). Mixing conventions across systems produces off-by-one-bar comparisons.
- Resampling is an AGGREGATION with a chosen function (mean, last, max). State the function; "the price at 10:00" is ambiguous (first tick in the bucket? last tick before 10:00? interpolated?).
- \`v.windowPeriod\` in Grafana Flux and \`aggregateWindow\` do dynamic resampling per zoom level; the function still must be chosen (\`mean\` smooths, \`last\` preserves step shape).
- Downsampling for retention: keep OHLCV of raw ticks in a long-horizon bucket; never keep raw ticks forever.

## GAP SEMANTICS: WHAT A GAP IN A CHART MEANS

A gap has exactly two honest meanings:

1. **A real lull**: no trades happened. Normal for illiquid pairs, normal overnight on some venues. The chart shows a hole; that hole is information.
2. **A silent failure**: the feed died, the writer crashed, points were rejected. The chart shows the same hole, but it is a LIE of absence.

You cannot tell them apart from the chart alone. That is why the pipeline publishes staleness states (healthy/warn/stale, see market-data-architecture invariant 3) alongside the data. The rule:

- Data gaps are rendered as gaps (\`createEmpty: false\` in Grafana).
- Feed health is rendered as a SEPARATE signal (staleness panel, annotations), never by smoothing the data to hide the hole.

\`\`\`flux
// Flux: honest rendering, gaps stay gaps
from(bucket: "market-data")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> aggregateWindow(every: v.windowPeriod, fn: last, createEmpty: false)
\`\`\`

## RETENTION AND DOWNSAMPLING

- Raw ticks: high write volume, short retention (e.g. 30 days). Enough for debugging and recent analysis.
- Downsampled bars: low volume, long retention (months to years). Built by a scheduled task from raw ticks.
- Retention is a POLICY set at bucket creation (\`retentionRules\`), not a hope that disk holds out.
- Never let a downsampling task silently fail: a gap in the downsampled series that the raw series does not have is a broken task, and it will be discovered during an incident.

## UTC AND MONOTONICITY

- All timestamps are UTC. InfluxDB stores UTC; Grafana renders in browser-local time; the exchange timestamps you ingest are epoch values that are timezone-free. The only place local time exists is human display.
- Naive \`datetime.now()\` is a bug: it bakes your server's UTC offset into the data. \`datetime.now(timezone.utc)\` or epoch values only.
- **Event time vs ingest time**: exchange_ts (when it happened) vs pub_ts (when we published it) vs write time (when InfluxDB got it). Store event time as the point time; keep ingest time as a field or separate measurement if you need pipeline-lag analysis.
- **Monotonicity**: within one series, timestamps should be non-decreasing. Out-of-order writes are allowed by InfluxDB (it stores them where they belong) but writers that emit decreasing timestamps per series usually indicate a clock or ordering bug; detect and log it.
- Clock skew between your server and the exchange shifts pub_ts vs exchange_ts; monitor the delta rather than assuming zero.

## THE CORE RULE: NEVER FABRICATE A POINT

Never write a data point that was not observed. This covers the common sins:

- **Forward-filling**: copying the last known price forward to "fill" a gap. The chart looks continuous; the data is fiction. Alerts on a filled price fire on stale data.
- **Zero-filling**: writing 0.0 for a missing bid/ask. Zero is a valid price for nothing; it corrupts min/max aggregations.
- **Interpolating**: inventing values between two observed points. Fine for DISPLAY smoothing in a client; never persisted.
- **Backfilling from memory**: writing "what the price probably was" after a crash. If it was not observed, it does not exist.

\`\`\`python
# Python: the wrong way and the right way
# WRONG: fabricate a point to keep the stream "continuous"
write(price=last_known_price, ts=now_ns)          # fiction

# RIGHT: write only observed points; let staleness tracking speak for the gap
if tick is not None:
    write(price=float(tick["last"]), ts=tick["exchange_ts_ns"])
# gap -> staleness state goes warn/stale -> Grafana + bot surface it
\`\`\`

If a consumer genuinely needs a regular grid (a strategy computing on 1-minute closes), it may hold the last known value IN MEMORY as "last known as of T", clearly labeled, but that value is never written back to storage as an observation.

## CHECKLIST

1. Am I storing events or samples? Does my schema say which?
2. Bucket edges: left/right convention consistent across producer and consumers?
3. Every aggregation function chosen deliberately (mean vs last vs first)?
4. Gaps rendered as gaps; feed health as a separate staleness signal?
5. Retention set at bucket creation; downsampling task monitored?
6. UTC everywhere; event time as point time; monotonicity checked?
7. Zero fabricated points: no forward-fill, no zero-fill, no interpolation in storage?
`,
}
