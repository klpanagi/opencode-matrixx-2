/**
 * Permission primitives for the V2 agent ruleset.
 *
 * OpenCode 2.x gates capabilities with ordered `{action, resource, effect}`
 * rules, not a `{tool: value}` map, so restrictions are expressed as rules.
 */

export type PermissionEffect = "allow" | "deny" | "ask"

export interface PermissionRule {
  action: string
  resource: string
  effect: PermissionEffect
}

export function rule(
  action: string,
  effect: PermissionEffect = "allow",
  resource = "*",
): PermissionRule {
  return { action, resource, effect }
}

export function denyActions(actions: string[]): PermissionRule[] {
  return actions.map((action) => rule(action, "deny"))
}

/**
 * A leading wildcard deny makes every action fall through to `deny`; evaluation
 * is last-match-wins, so the allows must follow it.
 */
export function allowActionsOnly(actions: string[]): PermissionRule[] {
  return [rule("*", "deny"), ...actions.map((action) => rule(action, "allow"))]
}
