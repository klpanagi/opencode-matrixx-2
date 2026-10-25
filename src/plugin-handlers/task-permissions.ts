/**
 * Task-store permission grants.
 *
 * The task store (`.matrixx/tasks/`) is a separate write channel from the
 * codebase. An agent whose prompt tells it to track work with tasks must be
 * able to reach it, no matter which agent happens to hold delegation rights.
 *
 * OpenCode 2.x expresses gating as an ordered `{action, resource, effect}`
 * ruleset where the last matching rule wins, so grants are appended after the
 * agent's own rules.
 */

import { type PermissionRule, rule } from "../shared/permission-compat"

/** The legacy todo tools are denied for every task-capable agent. */
export const denyTodoPermissions: PermissionRule[] = [
  rule("todowrite", "deny"),
  rule("todoread", "deny"),
]

/**
 * Tracking only: the agent may read and write its own task-store records but
 * may not delegate. Granted to every primary-capable agent.
 */
export const taskStorePermissions: PermissionRule[] = [
  rule("task_*", "allow"),
  ...denyTodoPermissions,
]

/** Tracking plus outgoing delegation via the task tool. */
export const fullTaskPermissions: PermissionRule[] = [
  rule("task", "allow"),
  rule("task_*", "allow"),
  rule("teammate", "allow"),
  ...denyTodoPermissions,
]

type AgentLike = { mode?: string; permissions?: PermissionRule[] }

/**
 * An agent that can be driven as a top-level session is expected to track its
 * own work in the task store. Derived from the declared mode, never from a
 * hardcoded name list — a name list is exactly what let the original drift go
 * unnoticed.
 */
export function isTaskStorePrimary(agent: AgentLike): boolean {
  return agent.mode === "primary" || agent.mode === "all"
}

/**
 * A read-only agent declares a `task` deny for itself. OpenCode 2.x keeps the
 * built-in subagent tool (`subagent`) and matrixx's own delegation tool
 * (`task`) as separate actions, so a read-only agent denies both.
 */
export function deniesDelegation(agent: AgentLike): boolean {
  return (agent.permissions ?? []).some(
    (r) => r.action === "task" && r.resource === "*" && r.effect === "deny",
  )
}

/** The permission grants a primary-capable agent is missing. */
export function deriveTaskPermissions(agent: AgentLike): PermissionRule[] {
  if (!isTaskStorePrimary(agent)) return []
  return deniesDelegation(agent) ? [...taskStorePermissions] : [...fullTaskPermissions]
}
