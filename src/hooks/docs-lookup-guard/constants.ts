import {
  CONTEXT7_QUERY_DOCS,
  CONTEXT7_RESOLVE_LIBRARY_ID,
} from "../../mcps/tool-names"

export const HOOK_NAME = "docs-lookup-guard"

export const OPERATOR_AGENT = "operator"

export const GUARDED_TOOLS = new Set([
  CONTEXT7_RESOLVE_LIBRARY_ID,
  CONTEXT7_QUERY_DOCS,
  "websearch",
])

export const DOC_INTENT_TRIGGERS = [
  "library docs lookup",
  "framework API reference",
  "official documentation query",
  "versioned docs search",
] as const

const OPERATOR_LOOKUP_INSTRUCTION =
  `Look up docs for <library> <topic> via ${CONTEXT7_RESOLVE_LIBRARY_ID} then ${CONTEXT7_QUERY_DOCS}`

export const NUDGE_MESSAGE =
  "[docs-lookup-guard] Prefer delegating docs lookup to the operator agent for context isolation — " +
  `use subagent(agent="operator") instead of calling context7/websearch docs tools directly. ` +
  `Example: subagent(agent="operator", prompt="${OPERATOR_LOOKUP_INSTRUCTION}"). ` +
  `Operator agents may call ${CONTEXT7_RESOLVE_LIBRARY_ID} / ${CONTEXT7_QUERY_DOCS} / websearch directly.`

export const FALLBACK_MESSAGE =
  "[docs-lookup-guard] Fallback: route this docs lookup to the operator agent (operator-direct) for context isolation — " +
  `use subagent(agent="operator", prompt="${OPERATOR_LOOKUP_INSTRUCTION}"). ` +
  "Direct context7/websearch docs calls from non-operator agents stay warn-first; the operator path is authoritative."
