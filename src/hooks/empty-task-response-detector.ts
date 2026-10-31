import type { MatrixxContext } from "../plugin/context"

// Actionable replacement for an empty task result: the call completed but produced no
// output. The orchestrator can fix and retry — the two causes below cover every observed
// occurrence, so the message names them instead of guessing.
const EMPTY_RESPONSE_WARNING = `[Task Empty Response Warning]

The task call completed with empty output, so there is no result to report.
Session ID: see tool metadata (session_id in task_metadata). Check /tmp/matrixx.log delegate-task entries for this session.
Classified likely causes:
1. Code-mode delegation: task was invoked from inside code-mode/execute (task has codemode:false) and ran without a top-level tool session. Fix: re-issue as a direct top-level task call, never inside execute.
2. Permission-denied nested delegation: a read-only consultant (Seraph/Smith) tried task()/subagent delegation its permissions deny, so the child never ran. Fix: use direct grep/glob/read/lsp_* in the consultant; reserve task() for the top-level orchestrator.
3. Empty model output: the child session completed without producing text (timeout, model fallback miss, or prompt that produced no assistant message). Fix: retry with a narrower prompt, verify model availability, read delegate-task log lines for observed message shape.
Next: re-issue the delegation as a direct tool call with load_skills set (pass [] when none; "tdd-enforcer" for code-writing categories); provide EITHER category OR subagent_type ("mouse" only via category, never as subagent_type). If still empty, attach the observed roles/shape from the log when reporting.`;

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
