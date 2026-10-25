/**
 * Mouse - Focused Task Executor
 *
 * Executes delegated tasks directly without spawning other agents.
 * Category-spawned executor with domain-specific configurations.
 *
 * Routing:
 * 1. GPT models (openai/*, github-copilot/gpt-*) -> gpt.ts (GPT-5.2 optimized)
 * 2. DeepSeek models (opencode-go/deepseek-*) -> deepseek.ts (DeepSeek-optimized)
 * 3. Mimo models (opencode-go/mimo-*) -> mimo.ts (Mimo-optimized)
 * 4. Qwen models (opencode-go/qwen-*) -> qwen.ts (Qwen-optimized)
 * 5. Default (Anthropic/Claude, etc.) -> default.ts (Claude-optimized)
 */

import type { AgentOverrideConfig } from "../../config/schema"
import { denyActions } from "../../shared/permission-compat"
import { type AgentConfig, parseModelRef } from "../agent-config"
import type { AgentMode } from "../types"
import {
  isAnthropicModel,
  isDeepSeekModel,
  isGptModel,
  isMimoModel,
  isQwenModel,
} from "../types"
import { buildDeepSeekMousePrompt } from "./deepseek"
import { buildDefaultMousePrompt } from "./default"
import { buildGptMousePrompt } from "./gpt"
import { buildMimoMousePrompt } from "./mimo"
import { buildQwenMousePrompt } from "./qwen"

const MODE: AgentMode = "subagent"

// Core actions that Mouse must NEVER have access to
const BLOCKED_ACTIONS = ["subagent"]

export const MOUSE_DEFAULTS = {
  model: "<provider>/<model>", // placeholder — resolved via active model preset or system default
  temperature: 0.1,
} as const

export type MousePromptSource = "default" | "gpt" | "deepseek" | "mimo" | "qwen"

/**
 * Determines which Mouse prompt to use based on model.
 */
export function getMousePromptSource(model?: string): MousePromptSource {
  if (!model) return "default"
  if (isGptModel(model)) return "gpt"
  if (isDeepSeekModel(model)) return "deepseek"
  if (isMimoModel(model)) return "mimo"
  if (isQwenModel(model)) return "qwen"
  return "default"
}

/**
 * Builds the appropriate Mouse prompt based on model.
 */
export function buildMousePrompt(
  model: string | undefined,
  promptAppend?: string,
): string {
  const source = getMousePromptSource(model)

  switch (source) {
    case "gpt":
      return buildGptMousePrompt(promptAppend)
    case "deepseek":
      return buildDeepSeekMousePrompt(promptAppend)
    case "mimo":
      return buildMimoMousePrompt(promptAppend)
    case "qwen":
      return buildQwenMousePrompt(promptAppend)
    default:
      return buildDefaultMousePrompt(promptAppend)
  }
}

export function createMouseAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
): AgentConfig {
  if (override?.disabled) {
    override = undefined
  }

  const model = override?.model ?? systemDefaultModel ?? MOUSE_DEFAULTS.model
  const overrideBody = override?.request?.body
  const overrideTemperature =
    typeof overrideBody?.temperature === "number" ? overrideBody.temperature : undefined
  const overrideTopP = typeof overrideBody?.top_p === "number" ? overrideBody.top_p : undefined
  const temperature = overrideTemperature ?? MOUSE_DEFAULTS.temperature

  const promptAppend = override?.system_append
  const prompt = buildMousePrompt(model, promptAppend)

  const permissions = [...(override?.permissions ?? []), ...denyActions(BLOCKED_ACTIONS)]

  const base: AgentConfig = {
    description: override?.description ??
      "Focused task executor. Same discipline, no delegation. (Mouse - Matrixx)",
    mode: MODE,
    model: parseModelRef(model),
    request: {
      body: {
        temperature,
        maxTokens: 64000,
        ...(overrideTopP !== undefined ? { top_p: overrideTopP } : {}),
      },
    },
    permissions,
    system: prompt,
    color: override?.color ?? "#20B2AA",
  }

  if (isGptModel(model)) {
    return {
      ...base,
      request: { body: { ...base.request?.body, reasoningEffort: "medium" } },
    }
  }

  if (isAnthropicModel(model) || isDeepSeekModel(model)) {
    return {
      ...base,
      request: {
        body: { ...base.request?.body, thinking: { type: "enabled", budgetTokens: 32000 } },
      },
    }
  }

  return base
}

createMouseAgentWithOverrides.mode = MODE
