import { describe, expect, test } from "bun:test"
import { buildPlanDemoteConfig } from "../../src/plugin-handlers/plan-model-inheritance"

describe("buildPlanDemoteConfig", () => {
  test("returns only mode when oracle and plan override are both undefined", () => {
    //#given
    const oracleConfig = undefined
    const planOverride = undefined

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then
    expect(result).toEqual({ mode: "subagent" })
  })

  test("extracts all model settings from oracle config", () => {
    // NOTE (V2): model settings are model/variant-inside-model/request —
    // flat sampling keys (temperature, thinking, ...) are not agent fields.
    //#given
    const oracleConfig = {
      name: "oracle",
      model: { providerID: "anthropic", id: "claude-opus-4-6", variant: "max" },
      mode: "all",
      system: "You are Oracle...",
      permissions: [{ action: "edit", resource: "*", effect: "allow" }],
      description: "Plan agent (Oracle)",
      color: "#FF5722",
      request: { body: { temperature: 0.1, thinking: { type: "enabled", budgetTokens: 10000 } } },
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, undefined)

    //#then - picks model settings, NOT system/permissions/description/color/name/mode
    expect(result.mode).toBe("subagent")
    expect(result.model).toEqual({ providerID: "anthropic", id: "claude-opus-4-6", variant: "max" })
    expect(result.request).toEqual({ body: { temperature: 0.1, thinking: { type: "enabled", budgetTokens: 10000 } } })
    expect(result.system).toBeUndefined()
    expect(result.permissions).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.color).toBeUndefined()
    expect(result.name).toBeUndefined()
    expect(result.variant).toBeUndefined()
  })

  test("plan override takes priority over oracle for all model settings", () => {
    //#given
    const oracleConfig = {
      model: { providerID: "anthropic", id: "claude-opus-4-6", variant: "max" },
      request: { body: { temperature: 0.1, reasoningEffort: "high" } },
    }
    const planOverride = {
      model: { providerID: "openai", id: "gpt-5.2", variant: "high" },
      request: { body: { temperature: 0.5, reasoningEffort: "low" } },
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then
    expect(result.model).toEqual({ providerID: "openai", id: "gpt-5.2", variant: "high" })
    expect(result.request).toEqual({ body: { temperature: 0.5, reasoningEffort: "low" } })
  })

  test("falls back to oracle when plan override has partial settings", () => {
    //#given
    const oracleConfig = {
      model: { providerID: "anthropic", id: "claude-opus-4-6", variant: "max" },
      request: { body: { temperature: 0.1, reasoningEffort: "high" } },
    }
    const planOverride = {
      model: { providerID: "openai", id: "gpt-5.2" },
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, planOverride)

    //#then - plan model wins, request inherits from oracle
    expect(result.model).toEqual({ providerID: "openai", id: "gpt-5.2" })
    expect(result.request).toEqual({ body: { temperature: 0.1, reasoningEffort: "high" } })
  })

  test("skips undefined values from both sources", () => {
    //#given
    const oracleConfig = {
      model: "anthropic/claude-opus-4-6",
    }

    //#when
    const result = buildPlanDemoteConfig(oracleConfig, undefined)

    //#then
    expect(result).toEqual({ mode: "subagent", model: "anthropic/claude-opus-4-6" })
    expect(Object.keys(result)).toEqual(["mode", "model"])
  })
})
