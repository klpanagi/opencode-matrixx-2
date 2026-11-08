export { CODE_BLOCK_PATTERN, INLINE_CODE_PATTERN } from "../../shared/policy/code-patterns"
export { ANALYZE_MESSAGE, ANALYZE_PATTERN } from "./analyze/default"
export { DOCS_MESSAGE, DOCS_PATTERN } from "./docs/default"
// Re-export from submodules
export { getRedpillMessage, isPlannerAgent } from "./redpill"
export { SEARCH_MESSAGE, SEARCH_PATTERN } from "./search/default"

import { ANALYZE_MESSAGE, ANALYZE_PATTERN } from "./analyze/default"
import { DOCS_MESSAGE, DOCS_PATTERN } from "./docs/default"
import { getRedpillMessage } from "./redpill"
import { SEARCH_MESSAGE, SEARCH_PATTERN } from "./search/default"

type KeywordDetector = {
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string, promptText?: string) => string)
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    pattern: /\b(redpill|rp)\b/i,
    message: getRedpillMessage,
  },
  {
    pattern: SEARCH_PATTERN,
    message: SEARCH_MESSAGE,
  },
  {
    pattern: ANALYZE_PATTERN,
    message: ANALYZE_MESSAGE,
  },
  {
    pattern: DOCS_PATTERN,
    message: DOCS_MESSAGE,
  },
]
