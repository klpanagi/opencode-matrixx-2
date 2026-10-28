export const HOOK_NAME = "software-dev-enforcement"

export const SOFTWARE_DEV_ENFORCEMENT_MARKER =
  "[SYSTEM DIRECTIVE: MATRIXX - SOFTWARE DEV ENFORCEMENT]"

export const READ_ONLY_SUBAGENT_TARGETS = ["trinity", "explore", "operator"] as const

export const CODE_WRITING_SUBAGENT_TARGETS = ["mouse", "sati"] as const

const CODE_WRITING_VERB_PATTERN =
  /\b(implement|refactor|write\s+code|write\s+(?:a\s+|the\s+)?(?:failing\s+)?tests?|add\s+(?:a\s+)?(?:feature|function|tests?|endpoint)|fix(?:es|ing)?(?:\s+the)?\s+bug|tdd|red-green-refactor|failing\s+tests?)\b/i

const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|swift|cs)\b/

export function isCodeWritingPrompt(prompt: string): boolean {
  return CODE_WRITING_VERB_PATTERN.test(prompt) || CODE_FILE_PATTERN.test(prompt)
}
