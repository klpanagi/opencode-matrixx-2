import type { BuiltinSkill } from "../types"

export const RESILIENCE_ERROR_TAXONOMY_SKILL_NAME = "resilience-error-taxonomy"

const RESILIENCE_ERROR_TAXONOMY_SKILL_DESCRIPTION =
  "Use when deciding retry, backoff, or fail-fast behavior for exchange calls and external I/O — the transient versus fatal error doctrine with bounded retries and explicit outcomes. Related: ccxt-rest, silent-failure-detection."

export const resilienceErrorTaxonomySkill: BuiltinSkill = {
  name: RESILIENCE_ERROR_TAXONOMY_SKILL_NAME,
  description: RESILIENCE_ERROR_TAXONOMY_SKILL_DESCRIPTION,
  template: `# Resilience — The One Error Taxonomy

## THE DOCTRINE

Every exception from an external call belongs to exactly one of two families. The response is determined by the family, never by the call site's mood.

**TRANSIENT** — the same call may succeed later. Retry, bounded, with exponential backoff + jitter.

- \`NetworkError\` (connectivity, DNS, HTTP 5xx)
- \`RequestTimeout\` (request exceeded its deadline)
- \`ExchangeNotAvailable\` (exchange down / maintenance)
- \`DDoSProtection\` (WAF / rate-limit rejection)
- \`RateLimitExceeded\` (explicit 429)

**FATAL** — retrying yields the identical failure. Do NOT retry. Skip, log, or disable the failing unit and move on.

- \`BadSymbol\` (unknown symbol)
- \`NotSupported\` (method not implemented for this exchange)
- \`Auth\` / \`AuthenticationError\` (bad keys, no permission)
- \`InsufficientFunds\` (balance too low for the order)
- \`InvalidOrder\` (size/price violates a market filter)

Why no retry for fatal: the input did not change. Retrying \`InsufficientFunds\` in a loop just burns rate limit and delays the moment you notice. A fatal error is information: the unit's configuration or entitlement is wrong, and a human or a supervisor must act.

## BOUNDED RETRY WITH BACKOFF + JITTER

\`\`\`python
import asyncio, random

TRANSIENT = (ccxt.NetworkError, ccxt.RequestTimeout, ccxt.ExchangeNotAvailable,
             ccxt.DDoSProtection, ccxt.RateLimitExceeded)

async def call_with_retry(fn, *, retries=3, base=0.5, cap=8.0):
    for attempt in range(retries):
        try:
            return await fn()
        except TRANSIENT as e:
            if attempt == retries - 1:
                raise
            delay = min(cap, base * 2 ** attempt)
            await asyncio.sleep(delay + random.uniform(0, base))
        except ccxt.ExchangeError:
            raise          # fatal: propagate immediately, no retry
\`\`\`

Bounded means bounded twice: a bounded attempt count AND a bounded total time. A retry loop without a deadline is a hang wearing a costume. Jitter prevents synchronized retry storms when many loops fail together (an exchange restart, for instance).

For \`RateLimitExceeded\` / \`DDoSProtection\`, back off HARDER than the formula suggests and honor any retry-after hint; these errors mean you are already pushing too fast.

## EXPLICIT SUCCESS/FAILURE DISCRIMINATOR

Every external call must produce an outcome the caller can discriminate. The two classic violations:

1. \`return None\` on failure, where None is also a plausible success value.
2. Returning a default (empty list, zero, last-known price) on failure, recorded downstream as a real outcome.

\`\`\`python
# BAD: failure is indistinguishable from "no trades yet"
async def get_trades(symbol):
    try:
        return await exchange.fetch_trades(symbol)
    except Exception:
        logger.warning("fetch failed")
        return []            # caller cannot tell failure from empty market

# GOOD: typed outcome
from dataclasses import dataclass

@dataclass
class Ok:
    value: list
@dataclass
class Err:
    error: Exception
    transient: bool

async def get_trades(symbol) -> Ok | Err:
    try:
        return Ok(await exchange.fetch_trades(symbol))
    except TRANSIENT as e:
        return Err(e, transient=True)
    except ccxt.ExchangeError as e:
        return Err(e, transient=False)
\`\`\`

The core rule: **never convert a failure into an outcome indistinguishable from success.** If downstream code cannot tell that something failed, you have built a silent failure (see silent-failure-detection). Typed outcomes, exceptions that propagate, or (ok, err) tuples all work; ambiguity does not.

## UNIT-LEVEL CONSEQUENCES

When a fatal error hits a unit (a symbol loop, a connector, a worker):

1. Record it: log with the unit id, increment a per-unit fatal counter.
2. Stop the unit's work: exit its loop, unsubscribe its stream, mark it disabled in whatever registry tracks units.
3. Make the disablement VISIBLE: the unit must not silently vanish from dashboards or reports. A disabled unit shows as "disabled with reason", not as "healthy" and not as absent.

\`\`\`python
except ccxt.InsufficientFunds as e:
    logger.error("unit %s disabled: %r", unit_id, e)
    registry.disable(unit_id, reason="insufficient_funds")   # visible state change
    break
\`\`\`

Transient failures, by contrast, keep the unit alive: count them, back off, and only escalate to disablement if the retry budget exhausts repeatedly (e.g. N consecutive budget exhaustions).

## RULES OF THUMB

- Two families, two responses: transient retries bounded, fatal never retries.
- Backoff = exponential + jitter, capped; harder for rate-limit errors.
- Every external call has an explicit success/failure discriminator.
- Never return a default that masquerades as a real outcome.
- Fatal errors disable the unit visibly, with a recorded reason.
- Retry budgets are finite; repeated exhaustion is itself a signal to escalate.
`,
}
