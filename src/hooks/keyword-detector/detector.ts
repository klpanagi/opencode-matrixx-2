import {
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  KEYWORD_DETECTORS,
} from "./constants"

interface DetectedKeyword {
  type: "ultrawork" | "search" | "analyze" | "docs"
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Resolves message to string, handling both static strings and dynamic functions.
 */
function resolveMessage(
  message: string | ((agentName?: string, modelID?: string) => string),
  agentName?: string,
  modelID?: string
): string {
  return typeof message === "function" ? message(agentName, modelID) : message
}

export function detectKeywordsWithType(text: string, agentName?: string, modelID?: string): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const types: Array<"ultrawork" | "search" | "analyze" | "docs"> = ["ultrawork", "search", "analyze", "docs"]
  const result: DetectedKeyword[] = []
  for (let i = 0; i < KEYWORD_DETECTORS.length; i++) {
    const detector = KEYWORD_DETECTORS[i]
    if (detector.pattern.test(textWithoutCode)) {
      result.push({
        type: types[i],
        message: resolveMessage(detector.message, agentName, modelID),
      })
    }
  }
  // docs-suppresses-search: a docs intent co-match suppresses the broad
  // SEARCH_PATTERN injection so pure doc lookups route to the operator
  // agent instead of fanning out parallel search agents.
  if (result.some((k) => k.type === "docs")) {
    return result.filter((k) => k.type !== "search")
  }
  return result
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
}
