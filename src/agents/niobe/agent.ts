/**
 * Niobe - Master Orchestrator Agent
 *
 * Orchestrates work via task() to complete ALL tasks in a todo list until fully done.
 * You are the captain of a crew of specialized agents.
 *
 * Routing:
 * 1. GPT models (openai/*, github-copilot/gpt-*) → gpt.ts (GPT-5.2 optimized)
 * 2. Default (Claude, etc.) → default.ts (Claude-optimized)
 */

import type { CategoryConfig } from "../../config/schema"
import { mergeCategories } from "../../shared/merge-categories"
import { denyActions } from "../../shared/permission-compat"
import { type AgentConfig, parseModelRef } from "../agent-config"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { buildCategorySkillsDelegationGuide } from "../dynamic-agent-prompt-builder"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"

import { getDefaultNiobePrompt } from "./default"
import { getGptNiobePrompt } from "./gpt"
import {
  buildAgentSelectionSection,
  buildCategorySection,
  buildDecisionMatrix,
  buildSkillsSection,
  getCategoryDescription,
} from "./prompt-section-builder"

const MODE: AgentMode = "primary"

export type NiobePromptSource = "default" | "gpt"

/**
 * Determines which Niobe prompt to use based on model.
 */
export function getNiobePromptSource(model?: string): NiobePromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

export interface OrchestratorContext {
  model?: string
  availableAgents?: AvailableAgent[]
  availableSkills?: AvailableSkill[]
  userCategories?: Record<string, CategoryConfig>
}

/**
 * Gets the appropriate Niobe prompt based on model.
 */
export function getNiobePrompt(model?: string): string {
  const source = getNiobePromptSource(model)

  switch (source) {
    case "gpt":
      return getGptNiobePrompt()
    default:
      return getDefaultNiobePrompt()
  }
}

function buildDynamicOrchestratorPrompt(ctx?: OrchestratorContext): string {
  const agents = ctx?.availableAgents ?? []
  const skills = ctx?.availableSkills ?? []
  const userCategories = ctx?.userCategories
  const model = ctx?.model

  const allCategories = mergeCategories(userCategories)
  const availableCategories: AvailableCategory[] = Object.entries(allCategories).map(([name]) => ({
    name,
    description: getCategoryDescription(name, userCategories),
  }))

  const categorySection = buildCategorySection(userCategories)
  const agentSection = buildAgentSelectionSection(agents)
  const decisionMatrix = buildDecisionMatrix(agents, userCategories)
  const skillsSection = buildSkillsSection(skills)
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(availableCategories, skills)

  const basePrompt = getNiobePrompt(model)

  return basePrompt
    .replace("{CATEGORY_SECTION}", categorySection)
    .replace("{AGENT_SECTION}", agentSection)
    .replace("{DECISION_MATRIX}", decisionMatrix)
    .replace("{SKILLS_SECTION}", skillsSection)
    .replace("{{CATEGORY_SKILLS_DELEGATION_GUIDE}}", categorySkillsGuide)
}

export function createNiobeAgent(ctx: OrchestratorContext): AgentConfig {
  // Sole deny is native subagent: Niobe orchestrates via task(). Factory is single
  // source of truth for outgoing-task allow (see #111 option b). Handler
  // (tool-config-handler.ts) is fill-only and must not override; incoming
  // task(subagent_type="niobe") remains rejected at subagent-resolver.ts:57
  // (different axis).

  const baseConfig: AgentConfig = {
    description:
      "Orchestrates work via task() to complete ALL tasks in a todo list until fully done. (Niobe - Matrixx)",
    mode: MODE,
    ...(ctx.model ? { model: parseModelRef(ctx.model) } : {}),
    request: { body: { temperature: 0.1 } },
    permissions: denyActions(["subagent"]),
    system: buildDynamicOrchestratorPrompt(ctx),
    color: "#10B981",
  }

  return baseConfig
}
createNiobeAgent.mode = MODE

export const niobePromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Niobe",
  triggers: [
    {
      domain: "Todo list orchestration",
      trigger: "Complete ALL tasks in a todo list with verification",
    },
    {
      domain: "Multi-agent coordination",
      trigger: "Parallel task execution across specialized agents",
    },
  ],
  useWhen: [
    "User provides a todo list path (.matrixx/plans/{name}.md)",
    "Multiple tasks need to be completed in sequence or parallel",
    "Work requires coordination across multiple specialized agents",
  ],
  avoidWhen: [
    "Single simple task that doesn't require orchestration",
    "Tasks that can be handled directly by one agent",
    "When user wants to execute tasks manually",
  ],
  keyTrigger:
    "Todo list path provided OR multiple tasks requiring multi-agent orchestration",
}
