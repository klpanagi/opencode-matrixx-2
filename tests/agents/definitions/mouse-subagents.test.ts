/// <reference types="bun-types" />
/**
 * Task 1.1: per-category mouse subagents (native spawn).
 *
 * The 8 delegation categories each get a dedicated worker agent
 * (mouse-construct … mouse-transmission) registered in the builtin
 * registry so OpenCode V2 can spawn them via the native subagent tool.
 */

import { describe, expect, spyOn, test } from "bun:test"
import { createBuiltinAgents } from "../../../src/agents/registry"
import {
  MOUSE_SUBAGENT_IDS,
  mouseSubagentFactories,
} from "../../../src/agents/definitions/mouse-subagents"
import { BuiltinAgentNameSchema } from "../../../src/config/schema/agent-names"
import * as shared from "../../../src/shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5"
const FETCH_MODELS = new Set([
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-6",
  "openai/gpt-5.2",
])

describe("mouse subagent registry", () => {
  test("all 8 per-category subagents are registered", async () => {
    //#given resolved models for registry composition
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed with defaults
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

      //#then every expected mouse-* id is present
      expect(MOUSE_SUBAGENT_IDS).toHaveLength(8)
      for (const id of MOUSE_SUBAGENT_IDS) {
        expect(agents[id]).toBeDefined()
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("each subagent passes both native gates (listing + spawn)", async () => {
    //#given registry composition with defaults
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

      //#then listing gate (mode !== "primary" && !hidden) and spawn gate (no subagent deny) hold
      for (const id of MOUSE_SUBAGENT_IDS) {
        const config = agents[id]
        expect(config.mode).toBe("subagent")
        expect(config.mode).not.toBe("primary")
        expect(config.hidden ?? false).toBe(false)
        const denySubagent = (config.permissions ?? []).some(
          (rule) => rule.action === "subagent" && rule.effect === "deny",
        )
        expect(denySubagent).toBe(false)
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("each subagent carries model default + temperature via request.body overlay", async () => {
    //#given registry composition with defaults
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

      //#then model resolves and temperature rides the request body overlay
      for (const id of MOUSE_SUBAGENT_IDS) {
        const config = agents[id]
        expect(config.model).toBeDefined()
        const temperature = (config.request?.body as Record<string, unknown> | undefined)?.temperature
        expect(typeof temperature).toBe("number")
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("each subagent has a meaningful description + category system prompt", async () => {
    //#given registry composition with defaults
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

      //#then description is non-empty and system carries the category fragment
      for (const id of MOUSE_SUBAGENT_IDS) {
        const config = agents[id]
        expect(typeof config.description).toBe("string")
        expect((config.description as string).length).toBeGreaterThan(0)
        expect(config.system as string).toContain("<Category_Context>")
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe("mouse subagent factories", () => {
  test("factory maps category id to a subagent-mode config", () => {
    //#given the eight registered factory ids
    //#when each factory builds a config for an explicit model
    //#then mode is subagent and the model ref matches the input
    for (const id of MOUSE_SUBAGENT_IDS) {
      const factory = mouseSubagentFactories[id]
      const config = factory(TEST_DEFAULT_MODEL)
      expect(config.mode).toBe("subagent")
      expect(config.model).toMatchObject({ providerID: "anthropic", id: "claude-sonnet-4-5" })
      expect(config.hidden).toBe(false)
    }
  })
})

describe("mouse subagent schema", () => {
  test("BuiltinAgentNameSchema accepts all 8 subagent ids", () => {
    //#given the eight expected subagent ids
    //#when each is parsed
    //#then all parse successfully
    for (const id of MOUSE_SUBAGENT_IDS) {
      expect(BuiltinAgentNameSchema.safeParse(id).success).toBe(true)
    }
  })

  test("unknown category agent name yields a clear schema error", () => {
    //#given an unknown mouse-* name
    //#when it is parsed
    //#then parsing fails with an invalid-enum issue
    const result = BuiltinAgentNameSchema.safeParse("mouse-unknown")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })
})

describe("mouse subagent integration", () => {
  test("prompt metadata exists for all 8 workers", async () => {
    //#given the metadata record exported alongside the factories
    const { MOUSE_SUBAGENT_PROMPT_METADATA } = await import(
      "../../../src/agents/definitions/mouse-subagents"
    )

    //#when each worker id is looked up
    //#then every entry has category, cost and at least one trigger
    for (const id of MOUSE_SUBAGENT_IDS) {
      const metadata = MOUSE_SUBAGENT_PROMPT_METADATA[id]
      expect(metadata).toBeDefined()
      expect(["exploration", "specialist", "advisor", "utility"]).toContain(metadata.category)
      expect(["FREE", "CHEAP", "EXPENSIVE"]).toContain(metadata.cost)
      expect(metadata.triggers.length).toBeGreaterThan(0)
    }
  })

  test("morpheus delegation prompt lists the 8 workers", async () => {
    //#given registry composition with defaults
    const { createBuiltinAgents: compose } = await import("../../../src/agents/registry")
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed
      const agents = await compose([], {}, undefined, TEST_DEFAULT_MODEL)

      //#then morpheus prompt references every worker id (metadata wiring proof)
      for (const id of MOUSE_SUBAGENT_IDS) {
        expect(agents.morpheus.system as string).toContain(id)
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("agent overrides schema retains per-worker entries", async () => {
    //#given an overrides object keyed by a worker id
    const { AgentOverridesSchema } = await import("../../../src/config/schema/agent-overrides")
    const overrides = { "mouse-source": { model: "anthropic/claude-sonnet-4-5" } }

    //#when it is parsed
    const result = AgentOverridesSchema.safeParse(overrides)

    //#then parsing succeeds and the worker entry is retained (not stripped)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data["mouse-source"]).toBeDefined()
    }
  })

  test("child-tool restrictions mirror mouse exactly", async () => {
    //#given mouse's restriction profile as the source of truth
    const { getAgentToolRestrictions } = await import(
      "../../../src/shared/tool/agent-tool-restrictions"
    )
    const mouseProfile = getAgentToolRestrictions("mouse")

    //#when each worker profile is read
    //#then it deep-equals mouse's profile
    for (const id of MOUSE_SUBAGENT_IDS) {
      expect(getAgentToolRestrictions(id)).toEqual(mouseProfile)
    }
    expect(mouseProfile).toEqual({ task: false })
  })

  test("display names resolve for all 8 workers", async () => {
    //#given the display-name lookup
    const { getAgentDisplayName } = await import("../../../src/shared/agent/agent-display-names")

    //#when each worker id is resolved
    //#then a human-readable name comes back (never the raw id)
    const expected: Record<string, string> = {
      "mouse-construct": "Mouse Construct",
      "mouse-source": "Mouse Source",
      "mouse-rabbit-hole": "Mouse Rabbit-Hole",
      "mouse-glitch": "Mouse Glitch",
      "mouse-bullet-time": "Mouse Bullet-Time",
      "mouse-blue-pill": "Mouse Blue-Pill",
      "mouse-the-one": "Mouse The-One",
      "mouse-transmission": "Mouse Transmission",
    }
    for (const id of MOUSE_SUBAGENT_IDS) {
      expect(getAgentDisplayName(id)).toBe(expected[id])
    }
  })

  test("agent resolver normalizes all 8 worker ids", async () => {
    //#given the runtime-fallback resolver
    const { normalizeAgentName } = await import("../../../src/hooks/runtime-fallback/agent-resolver")

    //#when each worker id is normalized
    //#then it round-trips exactly (not collapsed to "mouse")
    for (const id of MOUSE_SUBAGENT_IDS) {
      expect(normalizeAgentName(id)).toBe(id)
    }
  })
})

describe("mouse subagent task permissions", () => {
  test("workers receive mouse's task grant via the tool-config map", async () => {
    //#given production-shaped seeds: mouse with its declared subagent-deny, workers bare
    const { applyToolConfig } = await import("../../../src/plugin/handlers/tool-config-handler")
    const { denyActions } = await import("../../../src/shared/agent/permission-compat")
    const agentResult: Record<string, unknown> = {
      mouse: { mode: "subagent", permissions: denyActions(["subagent"]) },
    }
    for (const id of MOUSE_SUBAGENT_IDS) {
      agentResult[id] = { mode: "subagent" }
    }

    //#when the tool-config handler fills permissions
    applyToolConfig({ config: {}, pluginConfig: {} as never, agentResult })

    //#then each worker ruleset equals mouse's minus the subagent-deny, with task allows present
    type Rule = { action: string; resource?: string; effect: string }
    const rulesOf = (name: string): Rule[] =>
      ((agentResult[name] as { permissions?: Rule[] })?.permissions ?? []) as Rule[]
    const mouseRules = rulesOf("mouse")
    expect(mouseRules.some((r) => r.action === "subagent" && r.effect === "deny")).toBe(true)
    for (const id of MOUSE_SUBAGENT_IDS) {
      const workerRules = rulesOf(id)
      const mouseMinusDeny = mouseRules.filter(
        (r) => !(r.action === "subagent" && r.effect === "deny"),
      )
      expect(workerRules).toEqual(mouseMinusDeny)
      for (const action of ["task", "task_*", "teammate"]) {
        expect(workerRules.some((r) => r.action === action && r.effect === "allow")).toBe(true)
      }
      expect(
        workerRules.some((r) => r.action === "subagent" && r.effect === "deny"),
      ).toBe(false)
    }
  })
})
