import type { MatrixxContext } from "../plugin/context"

// Actionable replacement for an empty task result: the call completed but produced no
// output. The orchestrator can fix and retry — the two causes below cover every observed
// occurrence, so the message names them instead of guessing.
const EMPTY_RESPONSE_WARNING = `[Task Empty Response Warning]

The task call completed with empty output, so there is no result to report.
Observed: the tool returned an empty string for this call.
Likely causes:
1. The delegate-task tool was invoked from inside code mode, where it runs without a top-level tool session context.
2. The child session completed without producing text.
Next: re-issue the delegation as a direct tool call; if the output is still empty, read the delegate-task entries in /tmp/matrixx.log for this session.
Call shape reminders: load_skills is REQUIRED (pass [] when no skills are needed, and "tdd-enforcer" for code-writing categories); provide EITHER category OR subagent_type; "mouse" is reached through a category, never as subagent_type.`

export function createEmptyTaskResponseDetectorHook(_ctx: MatrixxContext) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return

      const responseText = output.output?.trim() ?? ""

      if (responseText === "") {
        output.output = EMPTY_RESPONSE_WARNING
      }
    },
  }
}
