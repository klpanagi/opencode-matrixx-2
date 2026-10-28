import type { BuiltinSkill } from "../types"

export const RESILIENCE_FAILURE_HUNTING_SKILL_NAME = "resilience-failure-hunting"

const RESILIENCE_FAILURE_HUNTING_SKILL_DESCRIPTION =
  "Use when hunting silent failures and resilience defects -- 6-pattern sweep, transient-vs-fatal taxonomy, typed outcomes, reconciliation checks, ast-grep recipes. Related: silent-failure-detection, resilience-error-taxonomy."

export const resilienceFailureHuntingSkill: BuiltinSkill = {
  name: RESILIENCE_FAILURE_HUNTING_SKILL_NAME,
  description: RESILIENCE_FAILURE_HUNTING_SKILL_DESCRIPTION,
  template: `# Resilience Failure Hunting -- The Silent-Failure Sweep

A hunting guide derived from the tank investigator role. Single driving question: what failure here would look like success? Sweep each target, cite file+line evidence, and report findings with severity and a concrete fix. For the full anti-pattern catalog and detection recipes, see silent-failure-detection; for the retry doctrine, see resilience-error-taxonomy.

## The 6-pattern sweep

### 1. except: pass
The purest silent failure: the error never existed. Sweep for bare except and except-with-pass bodies; every hit is a suspect.

### 2. Log-and-default
An except branch that logs a warning then returns a default (empty list, None, zero, last-known value) that downstream records as a real outcome. Logs are not outcomes.

### 3. Bare asyncio.gather
Without return_exceptions=True, the first exception propagates while sibling tasks keep running as unobserved orphans; a broad except around the gather collapses the batch failures into one line.

### 4. Empty-substitute configs
Any config that materializes empty structures for failed sources (empty candles, zero-filled series, createEmpty-style flags) converts source-failed into source-says-nothing-happened. Gaps must stay gaps.

### 5. Alert and line masking
An alert that fires so often it gets muted, or a dashboard line that draws a flat default through an outage. The channel exists but carries no signal.

### 6. Swallowed websocket errors
A WS read loop with a broad except-continue turns a dead feed into an idle loop: no crash, no data, no alarm. Every WS loop needs timeouts and a counted timeout branch.

## Error taxonomy: transient vs fatal

TRANSIENT (retry, bounded, exponential backoff + jitter): NetworkError, RequestTimeout, ExchangeNotAvailable, DDoSProtection, RateLimitExceeded. FATAL (do NOT retry -- skip, log, disable the unit): BadSymbol, NotSupported, Auth errors, InsufficientFunds, InvalidOrder. Bounded means bounded twice: attempt count AND total time.

## Success and failure discriminator

Every external call must produce an outcome the caller can discriminate. Flag None-on-failure where None is also a plausible success value, defaults recorded downstream as real outcomes, and Ok/Err outcomes that can collide with the success branch.

## Static sweep recipes

Run these against the codebase; each hit is a suspect to review, not automatically a bug. See silent-failure-detection for the full recipe list with ast-grep patterns for bare except, broad except-pass, gather without return_exceptions, and warning-then-default shapes, plus masking-config greps (createEmpty, conflate, CancelledError swallows).

## Dynamic checks: counters, canaries, reconciliation

- Per-branch counters: every except branch increments a named counter. A counter that never moves when its branch should fire is itself a finding.
- Synthetic canary: inject a known fault on a schedule and assert the pipeline REACTS (counter moves, alert fires, gap appears).
- Source-to-sink reconciliation: count units at the source and at every sink; the numbers must agree within tolerance. Divergence means silent loss.

## Hunting checklist

- [ ] No bare except or except-pass anywhere.
- [ ] Every except branch re-raises, returns a typed Err, or increments a counter AND changes observable state.
- [ ] No default returns from failure paths that a success path could also return.
- [ ] Every asyncio.gather has return_exceptions=True or a deliberate propagation design.
- [ ] No empty-substitute gap filling; gaps stay gaps and are counted.
- [ ] Every alert channel tested by a canary; no muted or flat-default channels.
- [ ] Source and sink counts reconciled automatically, with an alert on divergence.
- [ ] WS loops have timeouts and their timeout branch increments a counter.

Related: silent-failure-detection, resilience-error-taxonomy.
`,
}
