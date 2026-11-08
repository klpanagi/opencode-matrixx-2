import { composeManifesto, MATRIXX_ACTIVATION, type RedpillDomain } from "./manifesto"

function buildGlmMessage(domain: RedpillDomain): string {
  return `<redpill-mode>

${MATRIXX_ACTIVATION}

<output_verbosity_spec>
- Default: 1-2 focused paragraphs.
- Simple yes/no questions: 2 sentences or fewer.
- Complex multi-artifact work: 1 overview paragraph plus up to 4 outcome-grouped sections.
- Use lists only for distinct items, steps, scenarios, or options.
- Lead with the result, then the evidence, then any remaining blocker.
</output_verbosity_spec>

<scope_constraints>
- Implement EXACTLY and ONLY what the user requested.
- No bonus features, opportunistic refactors, or speculative cleanup.
- A one-shot operation does not need a helper, abstraction, flag, shim, or future-proofing.
- Validate only at boundaries. Trust internal guarantees unless evidence proves otherwise.
</scope_constraints>

## GLM CALIBRATION

GLM models are tuned for precise generation. Use shallow deliberation for routine edits and deep deliberation for architecture decisions, bug chains, concurrency, and security-sensitive work. Never fabricate exact line numbers, artifacts, interfaces, results, or status.

${composeManifesto(domain)}

</redpill-mode>

---
`
}

export const REDPILL_GLM_MESSAGE = buildGlmMessage("software")

export function getGlmRedpillMessage(domain: RedpillDomain = "software"): string {
  return buildGlmMessage(domain)
}
