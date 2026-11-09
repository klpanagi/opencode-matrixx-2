import { MAX_BACKGROUND_OUTPUT_CHARS } from "./constants"

const CONTEXT_MODE_MARKER = `\n\n... [output truncated to ${MAX_BACKGROUND_OUTPUT_CHARS} characters \u2014 context-mode budget; narrow the result with full_session: false, message_limit, since_message_id, or include_thinking: false] ...\n\n`

export function applyContextModeBudget(text: string): string {
  if (text.length <= MAX_BACKGROUND_OUTPUT_CHARS) return text
  const remaining = MAX_BACKGROUND_OUTPUT_CHARS - CONTEXT_MODE_MARKER.length
  const headLength = Math.max(0, Math.floor(remaining / 2))
  const tailLength = Math.max(0, remaining - headLength)
  return `${text.slice(0, headLength)}${CONTEXT_MODE_MARKER}${text.slice(text.length - tailLength)}`
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}
