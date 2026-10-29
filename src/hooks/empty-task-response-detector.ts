import type { PluginInput } from "@opencode-ai/plugin"

// Actionable replacement for an empty task result: the call completed but no
// subagent was spawned and no output was produced. The orchestrator can fix and
// retry — check these in order before assuming the delegation bridge is down.
const EMPTY_RESPONSE_WARNING = `[Task Empty Response Warning]

The task call completed but returned no response — no subagent was spawned.
Check the call shape and retry (the call has already completed):
1. load_skills is REQUIRED — pass [] if no skills are needed. Category "source" additionally requires "tdd-enforcer" in load_skills.
2. Provide EITHER category OR subagent_type (exactly one, never both, never neither).
3. Target a callable agent: "mouse" cannot be used via subagent_type (use a category instead); primary agents (e.g. niobe) cannot be called via task.
4. Do not call task nested inside execute/code-mode — re-issue it as a top-level task/subagent call so it has a session context to spawn from.
If the call shape is correct and this repeats, the delegation bridge is degraded: proceed directly, record it, and retry delegation later.`

export function createEmptyTaskResponseDetectorHook(_ctx: PluginInput) {
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
