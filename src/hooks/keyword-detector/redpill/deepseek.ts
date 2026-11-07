import { MATRIXX_ACTIVATION, MATRIXX_MANIFESTO_BODY } from "./manifesto"

export const REDPILL_DEEPSEEK_MESSAGE = `<redpill-mode>

${MATRIXX_ACTIVATION}

<thinking_mode>
  Thinking mode is ON by default on DeepSeek V4 Flash. For trivial tasks (single-file edit, typo fix, simple lookup), explicitly request thinking OFF. For complex tasks (architecture, multi-file, debugging, planning), keep thinking ON at high effort. When thinking is enabled, temperature/penalty parameters are ignored — tune the prompt instead. Never strip reasoning_content from assistant messages that contain tool_calls.
</thinking_mode>

<model_calibration>
  - Structure long context as a task sandwich: state the task before AND after the context.
  - Use labeled sections (Task / Context / Constraints / Evidence) to anchor output.
  - Self-check before reporting: re-read the request and verify each claim against a captured command output.
  - Temperature 0.0 for deterministic code and tool output.
</model_calibration>

${MATRIXX_MANIFESTO_BODY}

</redpill-mode>

---
`

export function getDeepseekRedpillMessage(): string {
  return REDPILL_DEEPSEEK_MESSAGE
}
