/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createNiobeAgent } from "../../src/agents/niobe/agent"
import { applyToolConfig } from "../../src/plugin-handlers/tool-config-handler"

type Rule = { action: string; resource?: string; effect: string }

describe("niobe factory outgoing-task allow (issue #111 option b)", () => {
  test("factory does not deny outgoing task()", () => {
    //#given
    const ctx = {}

    //#when
    const result = createNiobeAgent(ctx) as unknown as {
      permissions?: Rule[]
      mode?: string
    }

    //#then
    expect((result.permissions ?? []).some((r) => r.action === "task" && r.effect === "deny")).toBe(false)
    expect(result.mode).toBe("primary")
  })
})

describe("niobe handler fill-only semantics (issue #111 option b)", () => {
  test("taskSystem=true fills outgoing allow without overwriting", () => {
    //#given
    const agentResult: Record<string, unknown> = { niobe: { permission: {} } }

    //#when
    applyToolConfig({ config: {}, pluginConfig: { tasks: { enabled: true } }, agentResult })

    //#then
    const rules = (agentResult["niobe"] as { permissions: Rule[] }).permissions
    expect(rules.some((r) => r.action === "task" && r.effect === "allow")).toBe(true)
    expect(rules.some((r) => r.action === "task_*" && r.effect === "allow")).toBe(true)
    expect(rules.some((r) => r.action === "teammate" && r.effect === "allow")).toBe(true)
  })

  test("tasks.enabled=false no longer selects the legacy todos path", () => {
    //#given the legacy switch is pinned off
    const agentResult: Record<string, unknown> = { niobe: { permission: {} } }

    //#when the tool config is applied
    applyToolConfig({ config: {}, pluginConfig: { tasks: { enabled: false } }, agentResult })

    //#then the todo tools are denied just like with tasks.enabled=true
    const rules = (agentResult["niobe"] as { permissions: Rule[] }).permissions
    expect(rules.some((r) => r.action === "todowrite" && r.effect === "deny")).toBe(true)
    expect(rules.some((r) => r.action === "todoread" && r.effect === "deny")).toBe(true)
    expect(rules.some((r) => r.action === "task" && r.effect === "allow")).toBe(true)
  })

  test("fill-only preserves explicit factory deny (user override wins)", () => {
    //#given
    const agentResult: Record<string, unknown> = {
      niobe: { permissions: [{ action: "task", resource: "*", effect: "deny" }] },
    }

    //#when
    applyToolConfig({ config: {}, pluginConfig: { tasks: { enabled: true } }, agentResult })

    //#then - declared deny wins; no allow is granted for the same action
    const rules = (agentResult["niobe"] as { permissions: Rule[] }).permissions
    expect(rules.some((r) => r.action === "task" && r.effect === "deny")).toBe(true)
    expect(rules.some((r) => r.action === "task" && r.effect === "allow")).toBe(false)
  })
})
