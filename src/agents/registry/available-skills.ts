import type { BrowserAutomationProvider } from "../../config/schema"
import { type BuiltinSkill, createBuiltinSkills } from "../../skills"
import type { AvailableSkill } from "../shared/dynamic-agent-prompt-builder"

/**
 * Builtin skills other than the browser skill are lazy wrappers: their
 * `description` is empty until the `template` getter hydrates it from the
 * loader cache (see skills/loader/lazy-skill-helper.ts). Prompt tables need
 * the text, so force that hydration here. The getter self-destructs into
 * cached data properties, so this runs the skill factory at most once.
 */
function resolveDescription(skill: BuiltinSkill): string {
  if (skill.description) return skill.description
  void skill.template
  return skill.description
}

export function buildAvailableSkills(
  discoveredSkills: BuiltinSkill[],
  browserProvider?: BrowserAutomationProvider,
  disabledSkills?: Set<string>,
  currentAgent?: string
): AvailableSkill[] {
  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills })
  const builtinSkillNames = new Set(builtinSkills.map(s => s.name))

  const builtinAvailable: AvailableSkill[] = builtinSkills
    .filter((skill) => {
      if (skill.agent && currentAgent && skill.agent !== currentAgent) return false
      return true
    })
    .map((skill) => ({
      name: skill.name,
      description: resolveDescription(skill),
      location: "plugin" as const,
    }))

  const discoveredAvailable: AvailableSkill[] = discoveredSkills
    .filter((s) => {
      if (!builtinSkillNames.has(s.name) && !disabledSkills?.has(s.name)) {
        if (s.agent && currentAgent && s.agent !== currentAgent) return false
        return true
      }
      return false
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.description || "",
      location: "plugin" as const,
    }))

  return [...builtinAvailable, ...discoveredAvailable]
}
