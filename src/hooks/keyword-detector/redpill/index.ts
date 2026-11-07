/**
 * Redpill message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (oracle, plan) → planner.ts
 * 2. DeepSeek models → deepseek.ts
 * 3. Mimo models → mimo.ts
 * 4. GPT models → gpt5.2.ts
 * 5. Gemini models → gemini.ts
 * 6. GLM models → glm.ts
 * 7. Default (Claude, etc.) → default.ts
 */

export { getDeepseekRedpillMessage, REDPILL_DEEPSEEK_MESSAGE } from "./deepseek"
export { getDefaultRedpillMessage, REDPILL_DEFAULT_MESSAGE } from "./default"
export { getGeminiRedpillMessage, REDPILL_GEMINI_MESSAGE } from "./gemini"
export { getGlmRedpillMessage, REDPILL_GLM_MESSAGE } from "./glm"
export { getGptRedpillMessage, REDPILL_GPT_MESSAGE } from "./gpt5.2"
export { MATRIXX_ACTIVATION, MATRIXX_MANIFESTO_BODY, MATRIXX_PLANNER_OATH } from "./manifesto"
export { getMimoRedpillMessage, REDPILL_MIMO_MESSAGE } from "./mimo"
export { getPlannerRedpillMessage, REDPILL_PLANNER_SECTION } from "./planner"
export type { RedpillSource } from "./source-detector"
export { getRedpillSource, isDeepseekModel, isGeminiModel, isGlmModel, isGptModel, isMimoModel, isNonOmoAgent, isPlannerAgent } from "./source-detector"

import { getDeepseekRedpillMessage } from "./deepseek"
import { getDefaultRedpillMessage } from "./default"
import { getGeminiRedpillMessage } from "./gemini"
import { getGlmRedpillMessage } from "./glm"
import { getGptRedpillMessage } from "./gpt5.2"
import { getMimoRedpillMessage } from "./mimo"
import { getPlannerRedpillMessage } from "./planner"
import { getRedpillSource } from "./source-detector"

/**
 * Gets the appropriate redpill message based on agent and model context.
 */
export function getRedpillMessage(agentName?: string, modelID?: string): string {
  const source = getRedpillSource(agentName, modelID)

  switch (source) {
    case "planner":
      return getPlannerRedpillMessage()
    case "deepseek":
      return getDeepseekRedpillMessage()
    case "mimo":
      return getMimoRedpillMessage()
    case "gpt":
      return getGptRedpillMessage()
    case "gemini":
      return getGeminiRedpillMessage()
    case "glm":
      return getGlmRedpillMessage()
    default:
      return getDefaultRedpillMessage()
  }
}
