import {
  resolveSoftwareDevEnforcement,
  type SoftwareDevEnforcementConfigInput,
} from "../../config/schema"
import { MOUSE_AGENT } from "../../tools/delegate-task/mouse-agent"

/**
 * Precedence-aware helpers for software-dev enforcement (spec §8).
 * Pure derivations over resolved config; no I/O, no prompt mutation.
 */
export function isSoftwareDevOrchestratorTarget(
  agentToUse: string | undefined,
  enforcement?: SoftwareDevEnforcementConfigInput | null,
): boolean {
  if (!agentToUse) return false
  const { orchestrators } = resolveSoftwareDevEnforcement(enforcement)
  const lower = agentToUse.toLowerCase()
  return orchestrators.some((name) => name.toLowerCase() === lower)
}

export function isSoftwareDevExecutorTarget(agentToUse: string | undefined): boolean {
  return agentToUse === MOUSE_AGENT
}

/**
 * Fail-closed error for a required skill blocked by an explicit
 * disabled_skills entry. Same channel as skill-resolver errors:
 * returned as a string, never thrown, never silently bypassed.
 */
export function softwareDevDisabledSkillError(requiredSkill: string): string {
  return (
    `Software-dev enforcement: skill "${requiredSkill}" is disabled via disabled_skills, ` +
    `but it is required for this delegation. Re-enable "${requiredSkill}" ` +
    `or abandon the code task. Explicit disabled_skills entries are never silently bypassed.`
  )
}
