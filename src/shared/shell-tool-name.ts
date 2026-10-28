/**
 * Canonical shell/delegation tool-name predicates (OpenCode V2 compat).
 *
 * OpenCode V2 renamed the shell tool `bash` -> `shell` (no alias; the
 * effective name arrives at `tool.execute.before`). V1 configs still list
 * `bash` in `blocked_tools`, so every gate must accept BOTH spellings.
 * Centralize the compare here so no gate hardcodes a bare `"bash"` literal.
 */
export function isShellTool(name: unknown): boolean {
  const normalized = String(name ?? "").trim().toLowerCase()
  return normalized === "bash" || normalized === "shell"
}

/**
 * Delegation-tool predicate (V2 `task` -> `subagent` rename).
 * Kept as a SEPARATE export — never merge into isShellTool.
 * `task` is retained as a deprecated alias for V1 callers.
 */
export function isTaskTool(name: unknown): boolean {
  const normalized = String(name ?? "").trim().toLowerCase()
  return normalized === "task" || normalized === "subagent"
}
