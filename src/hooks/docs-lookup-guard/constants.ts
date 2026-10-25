export const HOOK_NAME = "docs-lookup-guard"

// Agent allowed to call docs-lookup tools directly without a nudge.
export const OPERATOR_AGENT = "operator"

// Tools guarded by docs-lookup-guard (all lowercase for O(1) case-insensitive match).
export const GUARDED_TOOLS = new Set([
  "context7_resolve-library-id",
  "context7_query-docs",
  "context7_get-library-docs",
  "websearch",
])

// Doc-intent triggers: direct library/framework doc lookups belong to the
// operator agent. Non-operator callers should delegate instead of calling
// context7/websearch docs tools directly (context isolation).
export const DOC_INTENT_TRIGGERS = [
  "library docs lookup",
  "framework API reference",
  "official documentation query",
  "versioned docs search",
] as const

export const NUDGE_MESSAGE =
  "[docs-lookup-guard] Prefer delegating docs lookup to the operator agent for context isolation — " +
  "use task(operator) instead of calling context7/websearch docs tools directly. " +
  "Example: task(subagent_type=\"operator\", prompt=\"Look up docs for <library> <topic> via context7_resolve-library-id then context7_query-docs\"). " +
  "Operator agents may call context7_resolve-library-id / context7_query-docs / context7_get-library-docs / websearch directly."

export const FALLBACK_MESSAGE =
  "[docs-lookup-guard] Fallback: route this docs lookup to the operator agent (operator-direct) for context isolation — " +
  "use task(subagent_type=\"operator\", prompt=\"Look up docs for <library> <topic> via context7_resolve-library-id then context7_query-docs\"). " +
  "Direct context7/websearch docs calls from non-operator agents stay warn-first; the operator path is authoritative."
