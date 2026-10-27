/// <reference types="bun-types" />

/**
 * Task 5: orchestrator static injection of the software-dev skill.
 *
 * morpheus/keymaker/niobe are built via maybeCreate*Config wrappers and oracle
 * via buildOracleAgentConfig — none of them flow through buildAgent, so the
 * static injection lands at those four construction sites through
 * prependStaticSkillTemplates (same mechanic as the buildAgent skills branch).
 * Mouse (BLOCKED subagent) must never receive the full template.
 */

import { describe, expect, spyOn, test } from "bun:test"
import { createBuiltinAgents } from "../../src/agents/builtin-agents"
import { createMouseAgentWithOverrides } from "../../src/agents/mouse/agent"
import { buildOracleAgentConfig } from "../../src/plugin-handlers/oracle-agent-config-builder"
import * as shared from "../../src/shared"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"
const CURRENT_MODEL = "anthropic/claude-sonnet-4-5"
const MARKER = "Software Development Pipeline"

const FETCH_MODELS = new Set([
  "anthropic/claude-opus-4-6",
  "zai-coding-plan/glm-4.7",
  "opencode/glm-4.7-free",
  "openai/gpt-5.2",
])

describe("orchestrator static software-dev injection", () => {
  test("morpheus/keymaker/niobe carry the software-dev template in system", async () => {
    //#given resolved models for all orchestrators
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when builtin agents are composed with defaults
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      //#then each orchestrator session-agent system opens with the full template
      expect(agents.morpheus.system as string).toContain(MARKER)
      expect(agents.keymaker.system as string).toContain(MARKER)
      expect(agents.niobe.system as string).toContain(MARKER)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("oracle carries the software-dev template in system", async () => {
    //#given the oracle builder with defaults
    //#when the oracle config is built
    const oracle = await buildOracleAgentConfig({
      configAgentPlan: undefined,
      pluginOracleOverride: undefined,
      userCategories: undefined,
      currentModel: CURRENT_MODEL,
    })

    //#then the full template is prepended
    expect(oracle.system as string).toContain(MARKER)
  })

  test("disabled software-dev leaves orchestrator systems untouched", async () => {
    //#given software-dev explicitly disabled
    const disabledSkills = new Set(["software-dev"])
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when agents compose with the disabled set
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined, disabledSkills)
      const oracle = await buildOracleAgentConfig({
        configAgentPlan: undefined,
        pluginOracleOverride: undefined,
        userCategories: undefined,
        currentModel: CURRENT_MODEL,
        disabledSkills,
      })

      //#then no orchestrator system carries the template (fail-open: no injection, no throw)
      expect(agents.morpheus.system as string).not.toContain(MARKER)
      expect(agents.keymaker.system as string).not.toContain(MARKER)
      expect(agents.niobe.system as string).not.toContain(MARKER)
      expect(oracle.system as string).not.toContain(MARKER)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("mouse never carries the software-dev template", async () => {
    //#given the mouse factory plus a fully composed registry
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(FETCH_MODELS)

    try {
      //#when mouse renders and orchestrators compose in the same process
      const mouse = createMouseAgentWithOverrides(undefined, CURRENT_MODEL)
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      //#then mouse is clean while orchestrators are injected
      expect(mouse.system as string).not.toContain(MARKER)
      expect(agents.morpheus.system as string).toContain(MARKER)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
