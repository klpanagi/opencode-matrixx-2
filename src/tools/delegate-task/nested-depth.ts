import { lookupSubagentParent } from "../../features/session-state/parent-registry"
import { getAgentToolRestrictions } from "../../shared/tool/agent-tool-restrictions"

/** A delegated child session is depth 1; only depth 0 may delegate. */
export const MAX_DELEGATION_DEPTH = 1

/**
 * Tools granted to a background child session. Deliberately empty: children
 * receive no delegation-capable tools. Widening this list is the rollback hook
 * for the depth cap.
 */
export const ALLOWED_CHILD_TOOLS: readonly string[] = []

/** Resolve "am I a child session?" — no registered parent means depth 0. */
export function resolveSessionDepth(sessionID: string | undefined): number {
  if (sessionID === undefined || sessionID === "") return 0
  return lookupSubagentParent(sessionID) === undefined ? 0 : 1
}

export function isNestedDelegation(sessionID: string | undefined): boolean {
  return resolveSessionDepth(sessionID) >= MAX_DELEGATION_DEPTH
}

/** Build the child tool map from the allowlist, agent restrictions, and hard denies. */
export function buildChildToolMap(agentName: string): Record<string, boolean> {
  const allowlisted = Object.fromEntries(ALLOWED_CHILD_TOOLS.map((tool) => [tool, true]))
  return {
    question: false,
    ...allowlisted,
    ...getAgentToolRestrictions(agentName),
    task: false,
  }
}
