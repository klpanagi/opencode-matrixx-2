import { MATRIXX_ACTIVATION, MATRIXX_MANIFESTO_BODY } from "./manifesto"

export const REDPILL_DEFAULT_MESSAGE = `<redpill-mode>

${MATRIXX_ACTIVATION}

${MATRIXX_MANIFESTO_BODY}

## CLAUDE CALIBRATION

- Lead with the outcome, then the evidence, then any remaining blocker.
- Prefer parallel background agents over sequential inline work.
- Think deeply on architecture, concurrency, and security; move fast on known patterns.
- When the plan agent is invoked, execute its wave order exactly and run the verification it specifies.

</redpill-mode>

---
`

export function getDefaultRedpillMessage(): string {
  return REDPILL_DEFAULT_MESSAGE
}
