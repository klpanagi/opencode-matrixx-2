import {
  isCodeWritingPrompt,
  SOFTWARE_DEV_ENFORCEMENT_MARKER,
} from "../../../hooks/software-dev-enforcement/constants"
import { resolveSoftwareDevEnforcementContent } from "../../../shared/software-dev-enforcement/payload"
// Phase 5: relocate to shared — src/tools/delegate-task/ is deleted in Phase 5.
import { isCodeWritingCategory } from "../../../tools/delegate-task/constants"
import { mouseCategoryFor } from "./complexity-rewrite"

export type EnforcementResolverFn = typeof resolveSoftwareDevEnforcementContent

export function applySubagentEnforcement(
  args: Record<string, unknown>,
  loadSkills: string[] = [],
  resolver: EnforcementResolverFn = resolveSoftwareDevEnforcementContent,
): boolean {
  const agent = args.agent
  if (typeof agent !== "string") return false
  const category = mouseCategoryFor(agent)
  if (!category || !isCodeWritingCategory(category)) return false
  const prompt = args.prompt
  if (typeof prompt !== "string" || prompt === "") return false
  if (prompt.includes(SOFTWARE_DEV_ENFORCEMENT_MARKER)) return false
  if (!isCodeWritingPrompt(prompt)) return false
  const result = resolver("mouse", category, loadSkills, {})
  const payload = result.content ?? result.error ?? undefined
  if (!payload) return false
  args.prompt = `<system-reminder>${SOFTWARE_DEV_ENFORCEMENT_MARKER}\n${payload}</system-reminder>\n${prompt}`
  return true
}
