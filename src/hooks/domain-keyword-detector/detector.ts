import { DOMAIN_HINT_MARKER, DOMAIN_SKILL_ROUTES, MAX_DOMAIN_HINT_CHARS } from "./constants"

/**
 * Detects finance-domain keywords in `text` and returns the matching skill
 * names (deduplicated, insertion order preserved).
 */
export function detectDomainSkills(text: string): string[] {
  const skills: string[] = []
  for (const route of DOMAIN_SKILL_ROUTES) {
    if (!route.pattern.test(text)) continue
    for (const skill of route.skills) {
      if (!skills.includes(skill)) skills.push(skill)
    }
  }
  return skills
}

/**
 * Builds the compact, capped context hint injected into the user message.
 */
export function buildDomainHint(skills: string[]): string {
  const hint = `${DOMAIN_HINT_MARKER} Relevant skills: ${skills.join(", ")}.`
  return hint.length > MAX_DOMAIN_HINT_CHARS ? hint.slice(0, MAX_DOMAIN_HINT_CHARS) : hint
}

/**
 * Extracts the concatenated text of all text parts of a message.
 */
export function extractMessageText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join(" ")
}
