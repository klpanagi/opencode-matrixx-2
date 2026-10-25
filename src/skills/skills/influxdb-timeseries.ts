import type { BuiltinSkill } from "../types"

export const INFLUXDB_TIMESERIES_SKILL_NAME = "influxdb-timeseries"

const INFLUXDB_TIMESERIES_SKILL_DESCRIPTION =
  "Use when writing market data to InfluxDB 2.x, designing buckets or measurements, or tuning influxdb-client-python batching — time-series storage for prices with explicit UTC-nanosecond timestamps, low-cardinality tags, and reliable batched writes. Related: time-series-fundamentals, data-quality-observability."

export const influxdbTimeseriesSkill: BuiltinSkill = {
  name: INFLUXDB_TIMESERIES_SKILL_NAME,
  description: INFLUXDB_TIMESERIES_SKILL_DESCRIPTION,
  template: `# InfluxDB 2.x for Market Data

## SCHEMA DESIGN: ONE MEASUREMENT, LOW-CARDINALITY TAGS

Store all price data in ONE measurement (e.g. \`prices\`). Do not create a measurement per symbol or per exchange; that fragments queries and explodes metadata.

- Tags (indexed, part of the series key): keep them LOW cardinality. \`exchange\` (binance, bybit, okx), \`market_type\` (spot, perp), \`symbol\` (BTC/USDT, ETH/USDT). Cardinality = product of all tag value combinations; every new symbol multiplies it. Never put a timestamp, price, or free-form ID in a tag.
- Fields (not indexed, stored per point): \`price\`, \`bid\`, \`ask\` as floats. Add more only when a consumer actually queries them.
- Field types are fixed by the first write. If you write \`price\` as a float and later send an integer, InfluxDB silently REJECTS the conflicting points. No error to your writer, no point in the bucket. This is the classic silent-rejection pitfall: always cast explicitly (\`float(...)\`) before writing.

\`\`\`python
# Python: point construction with explicit types and explicit time
from influxdb_client import Point
from datetime import datetime, timezone

point = (
    Point("prices")
    .tag("exchange", "binance")
    .tag("market_type", "perp")
    .tag("symbol", "BTC/USDT:USDT")
    .field("price", float(tick["last"]))   # explicit float: field-type conflicts are silently rejected
    .field("bid", float(tick["bid"]))
    .field("ask", float(tick["ask"]))
    .time(tick["exchange_ts"], WritePrecision.NS)  # ALWAYS explicit; see below
)
\`\`\`

## TIMESTAMPS: ALWAYS EXPLICIT UTC NANOSECONDS

Never rely on server-side timestamps (\`time(None, WritePrecision.NS)\`). The server clock is wrong for market data in three ways:

1. It records when InfluxDB received the point, not when the exchange observed it. Under retry or batching lag these diverge by seconds to minutes.
2. Server-side timestamps collapse points written in the same nanosecond window: a later write with the same field set OVERWRITES the earlier one. You lose ticks silently.
3. Charts and staleness math need the exchange's own clock.

Rules:

- Carry \`exchange_ts\` (the exchange's UTC timestamp, converted to nanoseconds) on every message end to end, and write THAT as \`Point.time\`.
- Use UTC everywhere. \`datetime.now(timezone.utc)\`, never naive \`datetime.now()\`. InfluxDB stores UTC; a naive local datetime shifts every point by your UTC offset.
- Monotonicity per series matters: if the exchange can emit out-of-order ticks, either sort before writing or accept that queries see the order you wrote.

\`\`\`python
# Python: exchange epoch-ms -> UTC nanoseconds
from influxdb_client.client.write_api import WritePrecision

ns = int(tick["exchange_ts"]) * 1_000_000  # epoch ms -> ns
point.time(ns, WritePrecision.NS)
\`\`\`

## BATCHED WRITES: WriteOptions AND CALLBACKS

Use the batching writer. Per-point HTTP writes waste connections and lose data on process death without any retry logic.

\`\`\`python
# Python (influxdb-client): batched async-friendly writer with callbacks
from influxdb_client import InfluxDBClient, WriteOptions
from influxdb_client.client.write_api import SYNCHRONOUS

client = InfluxDBClient(
    url="http://localhost:8086",
    token=TOKEN,               # writer token: write-only on the bucket
    org="trading",
    timeout=30_000,
)

write_api = client.write_api(
    write_options=WriteOptions(
        batch_size=500,        # points per HTTP batch
        flush_interval=1_000,  # ms; flush even if batch not full
        jitter_interval=250,   # ms; spreads flushes to avoid thundering herds
        retry_interval=2_000,  # ms; first retry backoff
        max_retries=5,         # give up after this; surface via callback
    )
)

def on_success(conf, data):
    pass  # batch accepted; keep this cheap, never log per batch at tick rates

def on_error(conf, data, exception):
    # THIS IS WHERE SILENT FAILURE GOES TO DIE. Log, count, alert.
    # data is the failed batch: persist to a dead-letter file or requeue.
    logger.error("influx write failed: %s (%d points)", exception, len(data))
    metrics.influx_write_errors.inc()

write_api.write(
    bucket="market-data",
    org="trading",
    record=points,
    on_success=on_success,
    on_error=on_error,
)
\`\`\`

Key behaviors:

- \`batch_size\` and \`flush_interval\` trade latency against throughput. For tick data, 500 points / 1 s flush is a sane start.
- \`jitter_interval\` matters when many processes write to the same server.
- Retries are exponential backoff on 429/503; \`max_retries\` exhausted calls \`on_error\`. If you do not pass \`on_error\`, failed batches vanish. Always pass it.
- For tests, scripts, and one-shot backfills use \`SYNCHRONOUS\` instead: errors raise immediately.

## ASYNC CLIENT

For asyncio pipelines (ccxt.pro loops, ZeroMQ consumers) use the async variant so writes never block the event loop:

\`\`\`python
# Python: async write api
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

async with InfluxDBClientAsync(url=URL, token=TOKEN, org=ORG) as client:
    write_api = client.write_api()
    await write_api.write(bucket="market-data", record=points)
\`\`\`

The async client supports the same batching options. Do not call the sync client from async code with \`await\`; it blocks the loop.

## BUCKETS AND RETENTION

Create the bucket with a retention policy at provisioning time; no InfluxDB tasks (downsampling cron) are needed for a simple 30-day window:

\`\`\`python
# Python: provision bucket with 30-day retention
from influxdb_client import BucketRetentionRules

bucket_api = client.buckets_api()
bucket_api.create_bucket(
    bucket_name="market-data",
    org_id=org_id,
    retention_rules=BucketRetentionRules(type="expire", every_seconds=30 * 24 * 3600),
)
\`\`\`

- One bucket for raw ticks with 30-day retention is enough for most setups. Grafana dashboards query it directly.
- If you later need long-horizon charts, add a downsampling task into a second bucket; do not extend raw-tick retention to years.
- Tokens follow least privilege: a WRITER token with write-only scope for the pipeline, a READ token for Grafana. Never reuse an all-access token.

## CARDINALITY CREEP

InfluxDB 2.x indexes every tag-value combination. Symptoms of creep: slow startup, high memory, OOM on restart.

- Budget: symbols x exchanges x market_types. 200 symbols x 5 exchanges x 2 market types = 2000 series, fine. Adding \`strategy_id\` or \`account\` as a tag multiplies it again.
- Anything with unbounded values (order IDs, client order IDs, raw symbol strings from user input) is a FIELD or a log line, never a tag.
- Watch the bucket's cardinality in the UI (Buckets -> cardininality estimate) after adding any tag.

## QUERYING (FLUX)

\`\`\`python
# Python: Flux query, last price per symbol
query = '''
from(bucket: "market-data")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> filter(fn: (r) => r.exchange == "binance" and r.market_type == "perp")
  |> last()
'''
tables = client.query_api().query(query, org="trading")
\`\`\`

## PITFALL CHECKLIST

| Pitfall | Consequence | Fix |
|---|---|---|
| Server-side timestamp | Overwrites, wrong event time | Explicit \`Point.time(exchange_ts_ns, NS)\` |
| Naive local datetime | All points shifted by UTC offset | \`timezone.utc\` everywhere |
| Mixed field types | Silent point rejection | Cast \`float()\` at the writer |
| No \`on_error\` callback | Failed batches vanish | Always pass callbacks; dead-letter on failure |
| High-cardinality tags | OOM, slow queries | Only exchange/market_type/symbol as tags |
| Per-symbol measurements | Query fragmentation | One measurement, tag-filtered |
| All-access token in pipeline | Blast radius on leak | Write-only writer token, read-only Grafana token |
`,
}
