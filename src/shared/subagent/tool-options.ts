/**
 * Registration options for the delegate-task tool.
 *
 * `task` spawns a nested agent, so the host cannot run it from inside a
 * code-mode `execute` block: the nested spawn has no top-level tool session
 * context and the call returns an empty string. Marking the tool as
 * direct-only keeps it out of the code-mode catalog and exposes it as a
 * direct tool, which is the only context where the spawn works.
 */
export const TASK_TOOL_OPTIONS = { codemode: false } as const
