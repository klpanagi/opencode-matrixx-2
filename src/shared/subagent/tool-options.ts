/**
 * Registration options for the removed `task` guard stub.
 *
 * The stub keeps the `task` name registered so old calls get a redirect
 * message (pointing at native `subagent`) instead of an unknown-tool error.
 * The host cannot run it from inside a code-mode `execute` block: a nested
 * spawn has no top-level tool session context and the call returns an empty
 * string. Marking it as direct-only keeps it out of the code-mode catalog
 * and exposes it as a direct tool, which is the only context where the
 * redirect works. The same `complexity`/`load_skills` keys it once carried
 * are now consumed by the subagent-policy transformer on native calls.
 */
export const TASK_TOOL_OPTIONS = { codemode: false } as const
