import { composeManifesto, MATRIXX_ACTIVATION, type RedpillDomain } from "./manifesto"

function buildDefaultMessage(domain: RedpillDomain): string {
  return `<redpill-mode>

${MATRIXX_ACTIVATION}

${composeManifesto(domain)}

## CLAUDE CALIBRATION

- Lead with the outcome, then the evidence, then any remaining blocker.
- Prefer parallel child subagents (fired in one turn; absorb their completion messages) over sequential inline work.
- Think deeply on architecture, reliability, and security; move fast on known patterns.
- When a planner is invoked, execute its wave order exactly and run the verification it specifies.

</redpill-mode>

---
`
}

export const REDPILL_DEFAULT_MESSAGE = buildDefaultMessage("software")

export function getDefaultRedpillMessage(domain: RedpillDomain = "software"): string {
  return buildDefaultMessage(domain)
}
