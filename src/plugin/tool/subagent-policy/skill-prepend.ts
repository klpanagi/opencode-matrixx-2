// Phase 5: shared modules relocated to src/shared/subagent/ (delegate-task/ deleted).
import { resolveSkillContent } from "../../../shared/subagent/skill-resolver"

export const LOAD_SKILLS_KEY = "load_skills"

export type SkillResolverFn = (
  skills: string[],
  options: { browserProvider?: "playwright" | "agent-browser" | "playwright-cli" | "dev-browser"; disabledSkills?: Set<string> },
) => { content: string | undefined; error: string | null }

export function readLoadSkills(args: Record<string, unknown>): string[] | undefined {
  const raw = args[LOAD_SKILLS_KEY]
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || !raw.every((s) => typeof s === "string")) {
    throw new Error(`[subagent-policy] "${LOAD_SKILLS_KEY}" must be a string array`)
  }
  return raw as string[]
}

export function applySkillPrepend(
  args: Record<string, unknown>,
  resolver: SkillResolverFn = resolveSkillContent,
): string[] {
  const skills = readLoadSkills(args)
  delete args[LOAD_SKILLS_KEY]
  if (!skills || skills.length === 0) return []
  const { content, error } = resolver(skills, {})
  if (error) {
    throw new Error(`[subagent-policy] ${error}`)
  }
  if (content) {
    const prompt = args.prompt
    if (typeof prompt === "string") {
      args.prompt = `${content}\n\n${prompt}`
    }
  }
  return skills
}
