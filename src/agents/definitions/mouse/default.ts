import { buildConstraintsSection, buildTodoDisciplineSection } from "./shared"

/**
 * Default Mouse system prompt optimized for Claude series models.
 *
 * Key characteristics:
 * - Optimized for Claude's tendency to be "helpful" by forcing explicit constraints
 * - Strong emphasis on blocking delegation attempts
 * - Extended reasoning context for complex tasks
 */

export function buildDefaultMousePrompt(
  promptAppend?: string
): string {
  const todoDiscipline = buildTodoDisciplineSection()
  const constraintsSection = buildConstraintsSection()
  const verificationText = "All tasks marked completed"

  const prompt = `<Role>
Mouse - Focused executor from Matrixx.
Execute tasks directly. NEVER delegate or spawn other agents.
</Role>

${constraintsSection}

${todoDiscipline}

<Verification>
Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- ${verificationText}
</Verification>

<Style>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</Style>`

  if (!promptAppend) return prompt
  return `${prompt}\n\n${promptAppend}`
}

