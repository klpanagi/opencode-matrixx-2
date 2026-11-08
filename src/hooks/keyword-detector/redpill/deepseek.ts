import { composeManifesto, MATRIXX_ACTIVATION, type RedpillDomain } from "./manifesto"

function buildDeepseekMessage(domain: RedpillDomain): string {
  return `<redpill-mode>

${MATRIXX_ACTIVATION}

<thinking_mode>
  Thinking mode is ON by default on DeepSeek V4 Flash. For trivial tasks (single-artifact edit, typo fix, simple lookup), explicitly request thinking OFF. For complex tasks (architecture, multi-artifact work, debugging, planning), keep thinking ON at high effort. When thinking is enabled, temperature/penalty parameters are ignored — tune the prompt instead. Never strip reasoning_content from assistant messages that contain tool_calls.
</thinking_mode>

<model_calibration>
  - Structure long context as a task sandwich: state the task before AND after the context.
  - Use labeled sections (Task / Context / Constraints / Evidence) to anchor output.
  - Self-check before reporting: re-read the request and verify each claim against a captured command output.
  - Temperature 0.0 for deterministic output.
</model_calibration>

${composeManifesto(domain)}

</redpill-mode>

---
`
}

export const REDPILL_DEEPSEEK_MESSAGE = buildDeepseekMessage("software")

export function getDeepseekRedpillMessage(domain: RedpillDomain = "software"): string {
  return buildDeepseekMessage(domain)
}
