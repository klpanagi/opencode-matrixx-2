import type { BuiltinSkill } from "../types"

export const GRAFANA_DASHBOARDS_SKILL_NAME = "grafana-dashboards"

const GRAFANA_DASHBOARDS_SKILL_DESCRIPTION =
  "Use when provisioning Grafana dashboards or datasources for market data, building price/basis/staleness panels, or templating InfluxDB-Flux variables — honest observability dashboards backed by InfluxDB 2.x. Related: influxdb-timeseries, data-quality-observability."

export const grafanaDashboardsSkill: BuiltinSkill = {
  name: GRAFANA_DASHBOARDS_SKILL_NAME,
  description: GRAFANA_DASHBOARDS_SKILL_DESCRIPTION,
  template: `# Grafana Dashboards for Market Data

## PROVISIONING: DATASOURCE AND DASHBOARDS AS CODE

Provision everything from files. Hand-built dashboards drift and cannot be reviewed.

\`\`\`yaml
# /etc/grafana/provisioning/datasources/influxdb.yaml
apiVersion: 1
datasources:
  - name: influxdb-market-data
    type: influxdb
    access: proxy
    url: http://influxdb:8086
    jsonData:
      version: Flux
      organization: trading
      defaultBucket: market-data
      tlsSkipVerify: false
    secureJsonData:
      token: \${INFLUX_READ_TOKEN}   # read-only token, env-injected, never committed
\`\`\`

\`\`\`yaml
# /etc/grafana/provisioning/dashboards/provider.yaml
apiVersion: 1
providers:
  - name: market-data
    orgId: 1
    folder: Market Data
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
\`\`\`

Dashboard JSON files live under that path. Keep them in git next to the pipeline code; a dashboard change is a code change.

## TEMPLATE VARIABLES: schema.tagValues

Use \`schema.tagValues\` query variables so panels filter by tags, not hardcoded strings. One \`symbol\` variable covers spot AND perp because both live in the same measurement with a \`market_type\` tag:

\`\`\`json
{
  "templating": {
    "list": [
      {
        "name": "symbol",
        "label": "Symbol",
        "type": "query",
        "datasource": "influxdb-market-data",
        "query": {
          "query": "import \\"influxdata/influxdb/schema\\" schema.tagValues(bucket: \\"market-data\\", tag: \\"symbol\\")",
          "refId": "symbol-variable"
        },
        "multi": true,
        "includeAll": true
      },
      {
        "name": "exchange",
        "label": "Exchange",
        "type": "query",
        "datasource": "influxdb-market-data",
        "query": {
          "query": "import \\"influxdata/influxdb/schema\\" schema.tagValues(bucket: \\"market-data\\", tag: \\"exchange\\")",
          "refId": "exchange-variable"
        },
        "multi": true,
        "includeAll": true
      }
    ]
  }
}
\`\`\`

In Flux, reference variables with \`v.symbol\` / \`v.exchange\` after \`import "influxdata/influxdb/schema"\`... actually import the variables package:

\`\`\`flux
// Flux: filter by dashboard variables
import "influxdata/influxdb/schema"

from(bucket: "market-data")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> filter(fn: (r) => contains(value: r.symbol, set: v.symbol))
  |> filter(fn: (r) => contains(value: r.exchange, set: v.exchange))
\`\`\`

## PRICE-OVER-TIME PANEL

Time series panel, one query per market type, grouped by tags so spot and perp for the same symbol overlay cleanly:

\`\`\`flux
from(bucket: "market-data")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> filter(fn: (r) => r.symbol == v.symbol)
  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)
  |> group(columns: ["exchange", "market_type"])
\`\`\`

Set \`createEmpty: false\`. With \`createEmpty: true\` Grafana fills gaps with null-interpolated points, which HIDES outages: a dead feed renders as a smooth line instead of a hole. Honest charts show the gap.

## BASIS PANEL: UNION + PIVOT, NOT JOIN

Basis = perp price minus spot price. Flux \`join\` on time is fragile (timestamps rarely align exactly). The robust pattern is \`union\` both streams, then \`pivot\` so spot and perp become columns of one row:

\`\`\`flux
spot = from(bucket: "market-data")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> filter(fn: (r) => r.symbol == v.symbol and r.market_type == "spot" and r.exchange == v.exchange)

perp = from(bucket: "market-data")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r._measurement == "prices" and r._field == "price")
  |> filter(fn: (r) => r.symbol == v.symbol and r.market_type == "perp" and r.exchange == v.exchange)

union(tables: [spot, perp])
  |> pivot(rowKey: ["_time"], columnKey: ["market_type"], valueColumn: "_value")
  |> map(fn: (r) => ({ r with _value: float(v: r.perp) - float(v: r.spot) }))
  |> set(key: "_field", value: "basis")
\`\`\`

Rows where only one side exists are dropped by the subtraction (null propagates), which is correct: no basis without both legs.

## STALENESS STAT PANEL

The recorder publishes a staleness state per series (0 = healthy, 1 = warn, 2 = stale). Show it as a stat panel with value mappings so operators read words, not numbers:

\`\`\`json
{
  "type": "stat",
  "title": "Feed staleness",
  "targets": [
    {
      "query": "from(bucket: \\"market-data\\") |> range(start: -5m) |> filter(fn: (r) => r._measurement == \\"staleness\\" and r._field == \\"state\\") |> last()",
      "refId": "A"
    }
  ],
  "fieldConfig": {
    "defaults": {
      "mappings": [
        { "type": "value", "options": { "0": { "text": "healthy", "color": "green" } } },
        { "type": "value", "options": { "1": { "text": "warn", "color": "yellow" } } },
        { "type": "value", "options": { "2": { "text": "stale", "color": "red" } } }
      ],
      "thresholds": {
        "steps": [
          { "color": "green", "value": null },
          { "color": "yellow", "value": 1 },
          { "color": "red", "value": 2 }
        ]
      }
    }
  }
}
\`\`\`

Thresholds follow the pipeline's staleness policy: warn when the last point is older than 2x the expected interval, stale past 5x. The dashboard must use the SAME thresholds as the recorder, or the panel lies.

## RECENT ALERT EVENTS

A table panel over alert events (written by the alerting component into InfluxDB) plus annotations so events appear as vertical lines on price charts:

\`\`\`flux
from(bucket: "market-data")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "alert_events")
  |> filter(fn: (r) => r._field == "message")
  |> last(column: "_time")
\`\`\`

For annotations, provision an annotation datasource pointing at the same InfluxDB and a query filtering \`alert_events\`; price panels then show alert markers inline.

## TOKENS: LEAST PRIVILEGE

- Grafana gets a READ-ONLY token scoped to the market-data bucket. It never writes.
- The recorder gets a WRITE-ONLY token. It never reads.
- Tokens go in env vars or a secret store, never in committed YAML. \`secureJsonData\` reads from the environment at provisioning time.

## PITFALLS

| Pitfall | Symptom | Fix |
|---|---|---|
| Server-side timestamps in the writer | Points overwrite each other; charts look smooth but wrong | Explicit exchange UTC-ns timestamps (see influxdb-timeseries) |
| \`createEmpty: true\` | Outages render as smooth lines | \`createEmpty: false\`; let gaps show |
| \`join()\` for basis | Missing rows, misaligned legs | \`union\` + \`pivot\` |
| Hardcoded symbol filters | Dashboard per symbol, unmaintainable | \`schema.tagValues\` variables |
| All-access token in datasource | Full bucket access from a viewer session | Read-only token |
| Dashboard drift | Hand-edited dashboards differ from git | Provisioning only; edits go through files |
`,
}
