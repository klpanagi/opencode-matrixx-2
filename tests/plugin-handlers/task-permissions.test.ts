/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createArchitectAgent } from "../../src/agents/architect"
import { createBddContractAgent } from "../../src/agents/bdd-contract"
import { createCipherAgent } from "../../src/agents/cipher"
import { createKeymakerAgent } from "../../src/agents/keymaker"
import { createMouseAgentWithOverrides } from "../../src/agents/mouse/agent"
import { createMorpheusAgent } from "../../src/agents/morpheus"
import { createSentinelAgent } from "../../src/agents/sentinel"
import { buildOracleAgentConfig } from "../../src/plugin-handlers/oracle-agent-config-builder"
import { applyToolConfig } from "../../src/plugin-handlers/tool-config-handler"
import type { MatrixxConfig } from "../../src/config"

const MODEL = "anthropic/claude-sonnet-4-5"

/**
 * The agent configs are produced by the real factories, so the mode used by the
 * assertions is the mode each agent definition actually declares. No name list.
 */
async function realAgentResult(): Promise<Record<string, unknown>> {
  const oracle = await buildOracleAgentConfig({
    configAgentPlan: undefined,
    pluginOracleOverride: undefined,
    userCategories: undefined,
    currentModel: MODEL,
  })
  return {
    morpheus: createMorpheusAgent(MODEL),
    keymaker: createKeymakerAgent(MODEL),
    architect: createArchitectAgent(MODEL),
    oracle,
    cipher: createCipherAgent(MODEL),
    sentinel: createSentinelAgent(MODEL),
    "bdd-contract": createBddContractAgent(MODEL),
    mouse: createMouseAgentWithOverrides(undefined, MODEL),
  }
}

type Rule = { action: string; resource?: string; effect: string }

function permissionOf(agentResult: Record<string, unknown>, name: string): Rule[] {
  const agent = agentResult[name] as { permissions?: Rule[] }
  return agent.permissions ?? []
}

function hasRule(rules: Rule[], action: string, effect: string): boolean {
  return rules.some((r) => r.action === action && r.effect === effect)
}

function modeOf(agentResult: Record<string, unknown>, name: string): string {
  return ((agentResult[name] as { mode?: string })?.mode ?? "subagent") as string
}

function apply(agentResult: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  applyToolConfig({ config, pluginConfig: {} as MatrixxConfig, agentResult })
  return config
}

describe("task-store permission grant (mode-derived)", () => {
  test("every primary/all agent may use the task store", async () => {
    //#given
    const agentResult = await realAgentResult()
    const eligible = Object.keys(agentResult).filter((name) => {
      const mode = modeOf(agentResult, name)
      return mode === "primary" || mode === "all"
    })
    expect(eligible.length).toBeGreaterThan(0)

    //#when
    apply(agentResult)

    //#then
    for (const name of eligible) {
      const permission = permissionOf(agentResult, name)
      expect(`${name}:${hasRule(permission, "task_*", "allow")}`).toBe(`${name}:true`)
    }
  })

  test("keymaker can record task-store progress (it is told to track work with tasks)", async () => {
    //#given
    const agentResult = await realAgentResult()

    //#when
    apply(agentResult)

    //#then
    const permission = permissionOf(agentResult, "keymaker")
    expect(hasRule(permission, "task_*", "allow")).toBe(true)
    expect(hasRule(permission, "task", "allow")).toBe(true)
  })

  test("sentinel keeps its own task denial but gains the task store", async () => {
    //#given
    const agentResult = await realAgentResult()

    //#when
    apply(agentResult)

    //#then
    const permission = permissionOf(agentResult, "sentinel")
    // Read-only applies to files; the task store is a separate write channel.
    expect(hasRule(permission, "task", "deny")).toBe(true)
    expect(hasRule(permission, "task_*", "allow")).toBe(true)
  })

  test("cipher may delegate per its own instructions", async () => {
    //#given
    const agentResult = await realAgentResult()

    //#when
    apply(agentResult)

    //#then
    const permission = permissionOf(agentResult, "cipher")
    expect(hasRule(permission, "task", "allow")).toBe(true)
    expect(hasRule(permission, "task_*", "allow")).toBe(true)
  })

  test("mouse carve-out: a subagent executor still gets full task permissions", async () => {
    //#given
    const agentResult = await realAgentResult()
    expect(modeOf(agentResult, "mouse")).toBe("subagent")

    //#when
    apply(agentResult)

    //#then
    const permission = permissionOf(agentResult, "mouse")
    expect(hasRule(permission, "task", "allow")).toBe(true)
    expect(hasRule(permission, "task_*", "allow")).toBe(true)
  })

  test("a user override is never clobbered by the derived or explicit grant", async () => {
    // NOTE: keymaker carries a handler-level explicit grant (it must reach
    // the task store for its core loop), but a declared deny still wins
    // (issue #111 option b: the handler is fill-only and must not override).
    //#given
    const agentResult = await realAgentResult()
    ;(agentResult.keymaker as { permissions?: Rule[] }).permissions = [
      { action: "task_*", resource: "*", effect: "deny" },
    ]

    //#when
    apply(agentResult)

    //#then - declared deny survives; no allow is granted for the same action
    expect(hasRule(permissionOf(agentResult, "keymaker"), "task_*", "deny")).toBe(true)
    expect(hasRule(permissionOf(agentResult, "keymaker"), "task_*", "allow")).toBe(false)
  })

  test("the legacy todo tools stay denied globally and per agent", async () => {
    //#given
    const agentResult = await realAgentResult()

    //#when
    const config = apply(agentResult)

    //#then - V2 has no global tool map; denies ride the per-agent ruleset
    expect(config.tools).toBeUndefined()
    expect(hasRule(permissionOf(agentResult, "keymaker"), "todowrite", "deny")).toBe(true)
    expect(hasRule(permissionOf(agentResult, "keymaker"), "todoread", "deny")).toBe(true)
  })

  test("a subagent with no task-store role is not granted delegation", async () => {
    //#given
    const agentResult: Record<string, unknown> = {
      "custom-sub": { mode: "subagent" },
    }

    //#when
    apply(agentResult)

    //#then
    const permission = permissionOf(agentResult, "custom-sub")
    expect(hasRule(permission, "task_*", "allow")).toBe(false)
    expect(hasRule(permission, "task", "allow")).toBe(false)
  })
})
