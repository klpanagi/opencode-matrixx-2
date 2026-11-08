import { composeManifesto, MATRIXX_ACTIVATION, type RedpillDomain } from "./manifesto"

function buildMimoMessage(domain: RedpillDomain): string {
  return `<redpill-mode>

${MATRIXX_ACTIVATION}

<plan>
Set mission, constraints, and the stop condition. Plan before acting.
</plan>

Mission: Deliver EXACTLY what the user asked, end-to-end working, with captured evidence. A single check alone never proves done.

Tier: LIGHT (known pattern, 1-2 criteria) or HEAVY (new module/auth/concurrency, 3+ criteria with review). Default LIGHT. Upgrade when unsure.

Scenarios: 3+ binary pass/fail — happy path, edge, regression. Each with a real-surface artifact and a check id.

${composeManifesto(domain)}

</redpill-mode>

---
`
}

export const REDPILL_MIMO_MESSAGE = buildMimoMessage("software")

export function getMimoRedpillMessage(domain: RedpillDomain = "software"): string {
  return buildMimoMessage(domain)
}
