import type { BuiltinSkill } from "../types"

export const SILENT_FAILURE_DETECTION_SKILL_NAME = "silent-failure-detection"

const SILENT_FAILURE_DETECTION_SKILL_DESCRIPTION =
  "Use when hunting swallowed errors, masked alerts, or failures that look like success in trading pipelines — anti-pattern catalog, ast-grep recipes, typed outcomes, and reconciliation checks. Related: resilience-error-taxonomy, data-quality-observability."

export const silentFailureDetectionSkill: BuiltinSkill = {
  name: SILENT_FAILURE_DETECTION_SKILL_NAME,
  description: SILENT_FAILURE_DETECTION_SKILL_DESCRIPTION,
  template: `# Silent Failure Detection — Finding Errors That Vanish

A silent failure is an error that happens but leaves no trace a consumer can act on: the process keeps running, the data keeps flowing, and the failure is indistinguishable from "nothing happened". In a market-data pipeline these are the worst bugs, because the system looks healthy while its output is wrong or dead.

## THE ANTI-PATTERN CATALOG

**1. \`except: pass\`** — the purest form. The error never existed.

\`\`\`python
try:
    publish(frame)
except Exception:
    pass          # frame lost, nobody knows
\`\`\`

**2. Log-and-default** — \`except Exception: logger.warning(...)\` then return a default that downstream records as a real outcome. The log line exists, but the DATA PATH shows success. Logs are not outcomes; a warning nobody greps for is a diary, not an alarm.

\`\`\`python
# BAD
try:
    rows = await fetch_candles(symbol)
except Exception as e:
    logger.warning("fetch failed: %r", e)
    rows = []                     # recorder writes an empty candle gap as if real
\`\`\`

**3. Bare \`asyncio.gather(...)\`** — without \`return_exceptions=True\`, the first exception propagates while sibling tasks keep running unobserved as orphans; with a broad \`except\` around the gather, the whole batch's failures collapse into one line.

**4. \`createEmpty: true\` hiding gaps** — any config that materializes empty structures for failed sources (empty candles, zero-filled series) converts "source failed" into "source says nothing happened". Gaps must stay gaps.

**5. Alert/line masking** — an alert or dashboard line that fires so often it gets muted, or a chart line that draws a flat default through an outage. The channel exists but carries no signal.

**6. Swallowed websocket errors** — a WS read loop with a broad \`except Exception: continue\` turns a dead feed into an idle loop: no crash, no data, no alarm.

## DETECTION RECIPES

### Static: ast-grep sweeps

Run these against the codebase; each hit is a suspect to review, not automatically a bug:

\`\`\`bash
# bare except: pass
ast-grep --lang python -p 'except: $$$' src/
# broad except with pass body
ast-grep --lang python -p 'except $E: pass' src/
# gather without return_exceptions
ast-grep --lang python -p 'asyncio.gather($$$)' src/ | grep -v return_exceptions
# warning-then-default shape (manual review)
rg -n 'except Exception' src/ -A 2 | rg -B 1 'return []|return None|return {}|continue'
\`\`\`

Also grep for the masking configs: \`createEmpty\`, \`conflate\` on recorder sockets, \`except CancelledError: pass\` (breaks shutdown).

### Dynamic: make failure un-hideable

- **Typed outcomes that cannot collide with success.** Every external call returns \`Ok | Err\` (or raises). No \`None\`/empty-list sentinels that a success path could also produce. See resilience-error-taxonomy.
- **Per-branch counters.** Every except branch increments a named counter (\`fetch_transient{symbol=BTC}\`, \`ws_timeout{symbol=ETH}\`). A counter that never moves when its branch should be firing is itself a finding. Export them; a failure with no counter is a failure with no evidence.
- **Synthetic canary.** Inject a known fault (kill a feed, corrupt a frame) on a schedule and assert the pipeline REACTS: a counter moves, an alert fires, a gap appears. A canary that passes while the alarm stays silent proves the alarm is broken.
- **Source-to-sink reconciliation.** Count units at the source (ticks received per symbol) and at every sink (rows written to InfluxDB, messages forwarded to Telegram, points on the dashboard). The numbers must agree within a known tolerance. Divergence = silent loss somewhere in between.

\`\`\`python
# reconciliation check
src_count = counters["ticks_in"][symbol].value
sink_count = counters["rows_written"][symbol].value
if sink_count < src_count * 0.99:
    logger.error("loss detected %s: src=%d sink=%d", symbol, src_count, sink_count)
    alert.fire("pipeline_loss", symbol)
\`\`\`

## REVIEW CHECKLIST

- [ ] No bare \`except:\` or \`except Exception: pass\` anywhere.
- [ ] Every except branch either re-raises, returns a typed Err, or increments a counter AND changes observable state.
- [ ] No default returns (\`[]\`, \`None\`, \`0\`, \`{}\`) from failure paths that a success path could also return.
- [ ] Every \`asyncio.gather\` has \`return_exceptions=True\` or a deliberate propagation design.
- [ ] No \`createEmpty\`-style gap filling; gaps stay gaps and are counted.
- [ ] Every alert channel tested by a canary within the last N days.
- [ ] Source and sink counts reconciled automatically, with an alert on divergence.
- [ ] WS loops have timeouts and their timeout branch increments a counter.

## BEFORE / AFTER

\`\`\`python
# BEFORE: three silent failures in eight lines
async def poll(symbol):
    try:
        t = await exchange.fetch_ticker(symbol)
    except Exception:
        logger.warning("poll failed")
        return
    try:
        await save(t)
    except Exception:
        pass

# AFTER: every branch observable
async def poll(symbol) -> Ok | Err:
    try:
        t = await exchange.fetch_ticker(symbol)
    except TRANSIENT as e:
        poll_transient.inc(symbol)
        return Err(e, transient=True)
    except ccxt.ExchangeError as e:
        poll_fatal.inc(symbol)
        return Err(e, transient=False)
    try:
        await save(t)
    except Exception as e:
        save_errors.inc(symbol)          # counted, surfaced, not swallowed
        raise
    poll_ok.inc(symbol)
    return Ok(t)
\`\`\`

## RULES OF THUMB

- Logs are not outcomes; counters and typed results are.
- A failure must be visible at every layer it passes through: code path, metrics, and sink data.
- Empty is not failure and failure is not empty; never let them share a representation.
- Test your alarms with canaries, not with hope.
- If a consumer cannot tell that something failed, the failure is not handled, it is hidden.
`,
}
