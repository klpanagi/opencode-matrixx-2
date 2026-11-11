import { describe, expect, test } from "bun:test"
import type { CategoryConfig } from "../../../src/config/schema"
import { mouseSubagentFactories } from "../../../src/agents/definitions/mouse-subagents"
import { collectPendingBuiltinAgents } from "../../../src/agents/registry/general-agents"

function collect(mergedCategories: Record<string, CategoryConfig>) {
  return collectPendingBuiltinAgents({
    agentSources: {
      "mouse-bullet-time": mouseSubagentFactories["mouse-bullet-time"],
    },
    agentMetadata: {},
    disabledAgents: [],
    agentOverrides: {},
    mergedCategories,
    availableModels: new Set<string>(),
  })
}

describe("collectPendingBuiltinAgents — mouse-* category model inheritance", () => {
  test("mouse-<category> registers the category's configured model", () => {
    //#given a category model coming from an active preset
    const mergedCategories = {
      "bullet-time": { model: "opencode-go/deepseek-v4.1-flash" } as CategoryConfig,
    }

    //#when
    const { pendingAgentConfigs } = collect(mergedCategories)

    //#then the worker uses the category model instead of the hardcoded chain[0]
    expect(pendingAgentConfigs.get("mouse-bullet-time")?.model).toEqual({
      providerID: "opencode-go",
      id: "deepseek-v4.1-flash",
    })
  })

  test("mouse-<category> falls back to the default chain when the category has no model", () => {
    //#given a category entry without a model
    const mergedCategories = { "bullet-time": {} as CategoryConfig }

    //#when
    const { pendingAgentConfigs } = collect(mergedCategories)

    //#then the default agent requirement chain still supplies a model
    expect(pendingAgentConfigs.get("mouse-bullet-time")?.model?.providerID).toBe("anthropic")
  })

  test("non-mouse agents ignore category models", () => {
    //#given a category model that collides with a non-mouse agent name
    const mergedCategories = {
      trinity: { model: "opencode-go/glm-5.3-flash" } as CategoryConfig,
    }

    //#when
    const { pendingAgentConfigs } = collect(mergedCategories)

    //#then trinity keeps its own requirement resolution
    expect(pendingAgentConfigs.get("trinity")?.model).not.toEqual({
      providerID: "opencode-go",
      id: "glm-5.3-flash",
    })
  })
})
