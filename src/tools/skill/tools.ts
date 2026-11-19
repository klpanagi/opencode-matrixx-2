import { z } from "zod"
import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"
import { type BuiltinSkill, createBuiltinSkills } from "../../skills"
import type { InstalledPackSkill } from "../../skills/packs/types"
import { TOOL_DESCRIPTION_NO_SKILLS, TOOL_DESCRIPTION_PREFIX } from "./constants"
import type { SkillArgs, SkillInfo, SkillLoadOptions } from "./types"

function loadedSkillToInfo(skill: BuiltinSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.description || "",
    location: undefined,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata as Record<string, string> | undefined,
    allowedTools: skill.allowedTools,
  }
}

function formatSkillsXml(skills: SkillInfo[]): string {
  if (skills.length === 0) return ""

  const skillsXml = skills.map(skill => `  <skill>${skill.name}</skill>`).join("\n")

  return `\n\n<available_skills>\n${skillsXml}\n</available_skills>\n\nCall skill(name) for detail on a specific skill. Names only are listed to save context; descriptions load lazily.`
}

/** Keeps the first occurrence of every name (builtin entries precede pack entries). */
function dedupeSkillsByName(skills: BuiltinSkill[]): BuiltinSkill[] {
  const seen = new Set<string>()
  const deduped: BuiltinSkill[] = []
  for (const skill of skills) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    deduped.push(skill)
  }
  return deduped
}

function isInstalledPackSkill(skill: BuiltinSkill): skill is InstalledPackSkill {
  return "source" in skill && skill.source === "pack"
}

/** Adds a pack section only when the merged list actually contains pack skills. */
function formatPackSkillsSection(skills: BuiltinSkill[]): string {
  const packNames = skills.filter(isInstalledPackSkill).map(skill => skill.name)
  if (packNames.length === 0) return ""
  return `\n\nInstalled skill packs: ${packNames.join(", ")}`
}

function buildDescription(skills: BuiltinSkill[]): string {
  const skillInfos = skills.map(loadedSkillToInfo)
  const base = skillInfos.length === 0
    ? TOOL_DESCRIPTION_NO_SKILLS
    : TOOL_DESCRIPTION_PREFIX + formatSkillsXml(skillInfos)
  return base + formatPackSkillsSection(skills)
}

export function createSkillTool(options: SkillLoadOptions = {}): MatrixxToolDefinition {
  let cachedSkills: BuiltinSkill[] | null = null
  let cachedDescription: string | null = null

  /** Pack installs can be turned off for a session without rebuilding the tool. */
  const isEnabled = (): boolean => options.isEnabled?.() ?? true

  const getSkills = (): BuiltinSkill[] => {
    if (!isEnabled()) return []
    if (options.refresh) return dedupeSkillsByName(options.refresh())
    if (options.skills) return options.skills
    if (cachedSkills) return cachedSkills
    cachedSkills = createBuiltinSkills({ disabledSkills: options?.disabledSkills })
    return cachedSkills
  }

  const getDescription = (): string => {
    // A refresh seam means the skill list is allowed to change, so the
    // description is rebuilt on every read instead of cached once.
    if (options.refresh) return buildDescription(getSkills())
    if (cachedDescription) return cachedDescription
    cachedDescription = buildDescription(getSkills())
    return cachedDescription
  }

  if (!options.refresh) {
    if (options.skills) {
      cachedDescription = buildDescription(options.skills)
    } else {
      getDescription()
    }
  }

  return defineTool("skill", {
    get description() {
      if (options.refresh) return getDescription()
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },
    args: {
      name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review')"),
    },
    async execute(args: SkillArgs, ctx?: { agent?: string }) {
      const skills = getSkills()
      let skill = skills.find(s => s.name === args.name)
      // matrixx-self-config is excluded from listings by default (opt-in heavy skill).
      // Allow explicit dynamic load when the user asks for it.
      if (!skill && args.name === "matrixx-self-config") {
        const { matrixxSelfConfigSkill } = await import("../../skills/builtin/core/matrixx-self-config")
        skill = matrixxSelfConfigSkill
      }

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(`Skill "${args.name}" not found. Available skills: ${available || "none"}`)
      }

      if (skill.agent && (!ctx?.agent || skill.agent !== ctx.agent)) {
        throw new Error(`Skill "${args.name}" is restricted to agent "${skill.agent}"`)
      }

      const body = skill.template
      const dir = process.cwd()

      const output = [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        "",
        body,
      ]

      return output.join("\n")
    },
  })
}

export const skill: MatrixxToolDefinition = createSkillTool()
