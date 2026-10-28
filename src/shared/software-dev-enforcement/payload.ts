import type { BrowserAutomationProvider, SoftwareDevEnforcementConfigInput } from "../../config/schema"
import { resolveSoftwareDevEnforcement } from "../../config/schema"
import { createBuiltinSkills } from "../../skills"
import { isCodeWritingCategory } from "../../tools/delegate-task/constants"
import {
  isSoftwareDevExecutorTarget,
  isSoftwareDevOrchestratorTarget,
  softwareDevDisabledSkillError,
} from "./targets"

export interface SoftwareDevEnforcementResult {
  content: string | undefined
  error: string | null
}

/**
 * Post-resolution software-dev enforcement (spec sections 4-6, Task 4).
 *
 * Keyed off the RESOLVED target (`resolution.agentToUse`) + resolved category via
 * `isCodeWritingCategory()` — never raw `args.category` for target discrimination
 * (the category path always fans to Mouse; raw category cannot distinguish
 * orchestrator vs executor).
 *
 * Decision table (spec section 4):
 * - orchestrator target (morpheus/keymaker/niobe/oracle) -> FULL software-dev template.
 * - Mouse + code-writing category (source) -> SUBSET: missing tdd-enforcer/git-master
 *   templates only, never full. Caller-present skills dedupe by name.
 * - anything else -> undefined, no payload.
 *
 * Disabled precedence (spec section 8): explicit disabled_skills entry for a
 * required skill fails closed even when master switch is off or mode is autoAppend;
 * `enabled=false` exempts everything else; `autoAppend` mode suppresses the
 * missing-tdd-enforcer throw but never the blocked-skill throw.
 */
export function resolveSoftwareDevEnforcementContent(
  agentToUse: string | undefined,
  resolvedCategory: string | undefined,
  loadSkills: string[],
  options?: {
    enforcement?: SoftwareDevEnforcementConfigInput | null
    disabledSkills?: Set<string> | string[]
    browserProvider?: BrowserAutomationProvider
  },
): SoftwareDevEnforcementResult {
  const enforcement = resolveSoftwareDevEnforcement(options?.enforcement)
  const disabled = options?.disabledSkills
  const isDisabled = (name: string): boolean =>
    disabled instanceof Set ? disabled.has(name) : (disabled ?? []).includes(name)

  if (isSoftwareDevOrchestratorTarget(agentToUse, options?.enforcement)) {
    if (isDisabled("software-dev")) {
      return { content: undefined, error: softwareDevDisabledSkillError("software-dev") }
    }
    // Same-name dedupe (exact-name, case-sensitive like skill-resolver):
    // caller already passed load_skills including "software-dev", so skillContent
    // already contains the full template — appending again would duplicate ~200 lines.
    if (loadSkills.includes("software-dev")) {
      return { content: undefined, error: null }
    }
    if (!enforcement.enabled) {
      return { content: undefined, error: null }
    }
    const full = createBuiltinSkills({
      browserProvider: options?.browserProvider,
      disabledSkills: options?.disabledSkills instanceof Set
        ? options.disabledSkills
        : new Set(options?.disabledSkills ?? []),
    }).find((s) => s.name === "software-dev")
    if (!full) {
      return { content: undefined, error: `Software-dev enforcement: skill "software-dev" is unavailable (disabled or missing). Re-enable it or abandon the orchestrator delegation.` }
    }
    return { content: full.template, error: null }
  }

  if (isSoftwareDevExecutorTarget(agentToUse) && isCodeWritingCategory(resolvedCategory)) {
    const subset = enforcement.executorsSubset.filter((name) =>
      name.toLowerCase() !== "software-dev",
    )
    const missing = subset.filter(
      (name) => !loadSkills.includes(name) && !isDisabled(name),
    )
    const blocked = subset.filter((name) => !loadSkills.includes(name) && isDisabled(name))
    if (blocked.length > 0) {
      return { content: undefined, error: softwareDevDisabledSkillError(blocked[0]) }
    }
    if (!enforcement.enabled) {
      return { content: undefined, error: null }
    }
    if (missing.length === 0) {
      return { content: undefined, error: null }
    }
    if (enforcement.mode === "failClosed") {
      if (!loadSkills.includes("tdd-enforcer")) {
        return {
          content: undefined,
          error:
            `TDD enforcement (issue #127): category "source" writes code and requires ` +
            `load_skills to include "tdd-enforcer". Add "tdd-enforcer" to load_skills. ` +
            `See docs/quality.md Part B.`,
        }
      }
    }
    const all = createBuiltinSkills({
      browserProvider: options?.browserProvider,
      disabledSkills: options?.disabledSkills instanceof Set
        ? options.disabledSkills
        : new Set(options?.disabledSkills ?? []),
    })
    const templates = missing
      .map((name) => all.find((s) => s.name === name)?.template)
      .filter((t): t is string => typeof t === "string")
    if (templates.length !== missing.length) {
      const found = new Set(
        missing.filter((name) => all.some((s) => s.name === name)),
      )
      const unavailable = missing.filter((name) => !found.has(name))
      return { content: undefined, error: `Skills not found: ${unavailable.join(", ")}. Available: ${all.map((s) => s.name).join(", ")}` }
    }
    return { content: templates.join("\n\n"), error: null }
  }

  return { content: undefined, error: null }
}
