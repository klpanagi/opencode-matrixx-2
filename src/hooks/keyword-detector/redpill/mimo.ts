import { MATRIXX_ACTIVATION, MATRIXX_MANIFESTO_BODY } from "./manifesto"

export const REDPILL_MIMO_MESSAGE = `<redpill-mode>

${MATRIXX_ACTIVATION}

<plan>
Set mission, constraints, and the stop condition. Plan before acting.
</plan>

Mission: Deliver EXACTLY what the user asked, end-to-end working, with captured evidence. Tests alone never prove done.

Tier: LIGHT (known pattern, 1-2 criteria) or HEAVY (new module/auth/concurrency, 3+ criteria with review). Default LIGHT. Upgrade when unsure.

Scenarios: 3+ binary pass/fail — happy path, edge, regression. Each with a real-surface artifact and a test id.

${MATRIXX_MANIFESTO_BODY}

</redpill-mode>

---
`

export function getMimoRedpillMessage(): string {
  return REDPILL_MIMO_MESSAGE
}
