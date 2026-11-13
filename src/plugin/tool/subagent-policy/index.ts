import { stripBackgroundArgs } from "./background-strip"
import type { ComplexityRewriteDeps } from "./complexity-rewrite"
import { applyComplexityRewrite } from "./complexity-rewrite"
import type { EnforcementResolverFn } from "./enforcement"
import { applySubagentEnforcement } from "./enforcement"
import type { SkillResolverFn } from "./skill-prepend"
import { applySkillPrepend } from "./skill-prepend"

export { BACKGROUND_KEYS, stripBackgroundArgs } from "./background-strip"
export { applyComplexityRewrite, mouseCategoryFor } from "./complexity-rewrite"
export { applySubagentEnforcement } from "./enforcement"
export { applySkillPrepend, readLoadSkills } from "./skill-prepend"
export { buildSubagentPolicyDeps } from "./wiring"

export interface SubagentPolicyDeps {
  skillResolver?: SkillResolverFn
  complexity?: ComplexityRewriteDeps
  enforcementResolver?: EnforcementResolverFn
  log?: (message: string, data?: unknown) => void
}

export function applySubagentPolicy(
  input: { tool: string },
  output: { args: Record<string, unknown> },
  deps: SubagentPolicyDeps = {},
): void {
  if (input.tool !== "subagent") return
  const args = output.args
  if (!args || typeof args !== "object") return
  stripBackgroundArgs(args, deps.log)
  const loadSkills = applySkillPrepend(args, deps.skillResolver)
  applyComplexityRewrite(args, deps.complexity, loadSkills)
  applySubagentEnforcement(args, loadSkills, deps.enforcementResolver)
}
