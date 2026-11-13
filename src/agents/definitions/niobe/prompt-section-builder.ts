/**
 * Niobe Orchestrator - Shared Utilities
 *
 * Common functions for building dynamic prompt sections used by both
 * default (Claude-optimized) and GPT-optimized prompts.
 */

import type { CategoryConfig } from "../../../config/schema"
import { truncateDescription } from "../../../shared/compaction/truncate-description"
import { CATEGORY_DESCRIPTIONS } from "../../../shared/subagent/delegation-constants"
import { mergeCategories } from "../../../shared/tool/merge-categories"
import { type AvailableAgent, type AvailableSkill, formatCustomSkillsBlock } from "../../shared/dynamic-agent-prompt-builder"

export const getCategoryDescription = (name: string, userCategories?: Record<string, CategoryConfig>) =>
  userCategories?.[name]?.description ?? CATEGORY_DESCRIPTIONS[name] ?? "General tasks"

export function buildAgentSelectionSection(agents: AvailableAgent[]): string {
   if (agents.length === 0) {
     return `##### Option B: Use AGENT directly (for specialized experts)

 No agents available.`
   }

   const rows = agents.map((a) => {
     const shortDesc = truncateDescription(a.description)
     return `| \`${a.name}\` | ${shortDesc} |`
   })

  return `##### Option B: Use AGENT directly (for specialized experts)

| Agent | Best For |
|-------|----------|
${rows.join("\n")}`
}

export function buildCategorySection(userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = mergeCategories(userCategories)
  const categoryRows = Object.entries(allCategories).map(([name, config]) => {
    const tempValue = config.request?.body?.temperature
    const temp = typeof tempValue === "number" ? tempValue : 0.1
    return `| \`${name}\` | ${temp} | ${getCategoryDescription(name, userCategories)} |`
  })

  return `##### Option A: Use MOUSE WORKER (for domain-specific work)

Categories spawn \`Mouse-{category}\` with optimized settings:

| Worker | Temperature | Best For |
|----------|-------------|----------|
${categoryRows.join("\n")}

\`\`\`typescript
subagent(agent="mouse-[category-name]", description="3-5 word title", load_skills=[...], prompt="...")
\`\`\``
}

export function buildSkillsSection(skills: AvailableSkill[]): string {
  if (skills.length === 0) {
    return ""
  }

  const builtinSkills = skills.filter((s) => s.location === "plugin")
  const customSkills = skills.filter((s) => s.location !== "plugin")

   const builtinRows = builtinSkills.map((s) => {
     const shortDesc = truncateDescription(s.description)
     return `| \`${s.name}\` | ${shortDesc} |`
   })

   const customRows = customSkills.map((s) => {
     const shortDesc = truncateDescription(s.description)
     const source = s.location === "project" ? "project" : "user"
     return `| \`${s.name}\` | ${shortDesc} | ${source} |`
   })

  const customSkillBlock = formatCustomSkillsBlock(customRows, customSkills, "**")

  let skillsTable: string

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsTable = `**Built-in Skills:**

| Skill | When to Use |
|-------|-------------|
${builtinRows.join("\n")}

${customSkillBlock}`
  } else if (customSkills.length > 0) {
    skillsTable = customSkillBlock
  } else {
    skillsTable = `| Skill | When to Use |
|-------|-------------|
${builtinRows.join("\n")}`
  }

  return `
#### 3.2.2: Skill Selection (PREPEND TO PROMPT)

**Skills are specialized instructions that guide subagent behavior. Consider them alongside category selection.**

${skillsTable}

**MANDATORY: Evaluate ALL skills (built-in AND user-installed) for relevance to your task.**

Read each skill's description and ask: "Does this skill's domain overlap with my task?"
- If YES: INCLUDE in load_skills=[...]
- If NO: You MUST justify why in your pre-delegation declaration

**Usage:**
\`\`\`typescript
subagent(agent="mouse-[category]", description="3-5 word title", load_skills=["skill-1", "skill-2"], prompt="...")
\`\`\`

**IMPORTANT:**
- Skills get prepended to the subagent's prompt, providing domain-specific instructions
- Subagents are STATELESS - they don't know what skills exist unless you include them
- Missing a relevant skill = suboptimal output quality`
}

export function buildDecisionMatrix(agents: AvailableAgent[], userCategories?: Record<string, CategoryConfig>): string {
  const allCategories = mergeCategories(userCategories)

  const categoryRows = Object.entries(allCategories).map(([name]) =>
    `| ${getCategoryDescription(name, userCategories)} | \`agent="mouse-${name}", load_skills=[...]\` |`
  )

   const agentRows = agents.map((a) => {
     const shortDesc = truncateDescription(a.description)
     return `| ${shortDesc} | \`agent="${a.name}"\` |`
   })

  return `##### Decision Matrix

| Task Domain | Use |
|-------------|-----|
${categoryRows.join("\n")}
${agentRows.join("\n")}

**Provide exactly one agent — a mouse-<category> worker or a named agent.**`
}
