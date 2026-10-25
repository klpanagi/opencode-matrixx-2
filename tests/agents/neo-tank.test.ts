/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createNeoAgent, NEO_PROMPT_METADATA } from "../../src/agents/neo"
import { createTankAgent, TANK_PROMPT_METADATA } from "../../src/agents/tank"
import { BuiltinAgentNameSchema } from "../../src/config/schema/agent-names"
import { agentPattern } from "../../src/hooks/runtime-fallback/agent-resolver"
import { AGENT_DISPLAY_NAMES } from "../../src/shared/agent-display-names"
import { getAgentToolRestrictions } from "../../src/shared/agent-tool-restrictions"

function skillsOf(config: unknown): string[] {
  return (config as Record<string, unknown>).skills as string[]
}

describe("createNeoAgent", () => {
  test("returns a subagent config with read-only restrictions", () => {
    //#given
    const model = "anthropic/claude-sonnet-4-6"

    //#when
    const config = createNeoAgent(model)

    //#then
    expect(config.mode).toBe("subagent")
    expect(config.model).toBe(model)
    expect(config.temperature).toBe(0.1)
    const permission = (config as Record<string, unknown>).permission as Record<string, string>
    expect(permission.write).toBe("deny")
    expect(permission.edit).toBe("deny")
    expect(permission.multiedit).toBe("deny")
    expect(permission.task).toBe("deny")
  })

  test("carries the market-data skill set", () => {
    //#given
    const config = createNeoAgent("anthropic/claude-sonnet-4-6")

    //#when
    const skills = skillsOf(config)

    //#then
    expect(skills).toContain("market-data-architecture")
    expect(skills).toContain("ccxt-pro-websockets")
    expect(skills).toContain("ccxt-rest")
    expect(skills).toContain("zeromq-pubsub")
    expect(skills).toContain("zeromq-reliability")
    expect(skills).toContain("zeromq-architecture")
    expect(skills).toContain("data-quality-observability")
  })

  test("uses GPT reasoning settings for GPT models", () => {
    //#given
    const model = "openai/gpt-5.2"

    //#when
    const config = createNeoAgent(model)

    //#then
    expect(config.reasoningEffort).toBe("medium")
    expect(config.thinking).toBeUndefined()
  })

  test("exposes the .mode static required by the AgentFactory form", () => {
    //#given / #when / #then
    expect(createNeoAgent.mode).toBe("subagent")
  })

  test("prompt encodes the structured verdict contract and the 9 invariants", () => {
    //#given
    const config = createNeoAgent("anthropic/claude-sonnet-4-6")

    //#when
    const prompt = config.prompt as string

    //#then
    expect(prompt).toContain("\"status\"")
    expect(prompt).toContain("\"violations\"")
    expect(prompt).toContain("snapshot")
    expect(prompt).toContain("no silent failure")
  })
})

describe("createTankAgent", () => {
  test("returns a subagent config at temperature 0.0 with read-only restrictions", () => {
    //#given
    const model = "anthropic/claude-sonnet-4-6"

    //#when
    const config = createTankAgent(model)

    //#then
    expect(config.mode).toBe("subagent")
    expect(config.model).toBe(model)
    expect(config.temperature).toBe(0.0)
    const permission = (config as Record<string, unknown>).permission as Record<string, string>
    expect(permission.write).toBe("deny")
    expect(permission.edit).toBe("deny")
    expect(permission.multiedit).toBe("deny")
    expect(permission.task).toBe("deny")
  })

  test("carries the resilience skill set", () => {
    //#given
    const config = createTankAgent("anthropic/claude-sonnet-4-6")

    //#when
    const skills = skillsOf(config)

    //#then
    expect(skills).toContain("silent-failure-detection")
    expect(skills).toContain("resilience-error-taxonomy")
    expect(skills).toContain("data-quality-observability")
    expect(skills).toContain("ccxt-rest")
  })

  test("exposes the .mode static required by the AgentFactory form", () => {
    //#given / #when / #then
    expect(createTankAgent.mode).toBe("subagent")
  })

  test("prompt encodes the structured findings contract", () => {
    //#given
    const config = createTankAgent("anthropic/claude-sonnet-4-6")

    //#when
    const prompt = config.prompt as string

    //#then
    expect(prompt).toContain("\"findings\"")
    expect(prompt).toContain("why_silent")
    expect(prompt).toContain("look like success")
  })
})

describe("NEO_PROMPT_METADATA / TANK_PROMPT_METADATA", () => {
  test("both are specialist, expensive, with a promptAlias", () => {
    //#given / #when / #then
    expect(NEO_PROMPT_METADATA.category).toBe("specialist")
    expect(NEO_PROMPT_METADATA.cost).toBe("EXPENSIVE")
    expect(NEO_PROMPT_METADATA.promptAlias).toBe("Neo")
    expect(TANK_PROMPT_METADATA.category).toBe("specialist")
    expect(TANK_PROMPT_METADATA.cost).toBe("EXPENSIVE")
    expect(TANK_PROMPT_METADATA.promptAlias).toBe("Tank")
  })

  test("both declare domain triggers, useWhen and avoidWhen", () => {
    //#given / #when / #then
    expect(NEO_PROMPT_METADATA.triggers.length).toBeGreaterThanOrEqual(4)
    expect(NEO_PROMPT_METADATA.useWhen?.length).toBeGreaterThan(0)
    expect(NEO_PROMPT_METADATA.avoidWhen?.length).toBeGreaterThan(0)
    expect(TANK_PROMPT_METADATA.triggers.length).toBeGreaterThanOrEqual(4)
    expect(TANK_PROMPT_METADATA.useWhen?.length).toBeGreaterThan(0)
    expect(TANK_PROMPT_METADATA.avoidWhen?.length).toBeGreaterThan(0)
  })
})

describe("neo/tank registration surfaces", () => {
  for (const name of ["neo", "tank"]) {
    test(`BuiltinAgentNameSchema accepts "${name}"`, () => {
      //#given / #when
      const parsed = BuiltinAgentNameSchema.safeParse(name)

      //#then
      expect(parsed.success).toBe(true)
    })

    test(`AGENT_DISPLAY_NAMES carries a display name for "${name}"`, () => {
      //#given / #when
      const displayName = AGENT_DISPLAY_NAMES[name]

      //#then
      expect(typeof displayName).toBe("string")
      expect(displayName).not.toBe("")
    })

    test(`AGENT_RESTRICTIONS denies write and edit for "${name}"`, () => {
      //#given / #when
      const restrictions = getAgentToolRestrictions(name)

      //#then
      expect(restrictions.write).toBe(false)
      expect(restrictions.edit).toBe(false)
    })

    test(`the derived agentPattern regex matches "${name}" in prose`, () => {
      //#given
      const message = `Falling back for agent ${name} (1 of 2)`

      //#when
      const matched = agentPattern.test(message)

      //#then
      expect(matched).toBe(true)
    })
  }
})
