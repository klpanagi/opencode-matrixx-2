/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createMerovingianAgent } from "../../src/agents/definitions/merovingian"
import { createOperatorAgent } from "../../src/agents/definitions/operator"
import { createTrinityAgent } from "../../src/agents/definitions/trinity"
import { createConstructAgent } from "../../src/agents/definitions/construct"
import { createMouseAgentWithOverrides } from "../../src/agents/definitions/mouse/agent"

function deniedActions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return []
  return permissions
    .filter((rule) => typeof rule === "object" && rule !== null && (rule as { effect?: string }).effect === "deny")
    .map((rule) => (rule as { action?: string }).action ?? "")
}


function allowedActions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return []
  return permissions
    .filter((rule) => typeof rule === "object" && rule !== null && (rule as { effect?: string }).effect === "allow")
    .map((rule) => (rule as { action?: string }).action ?? "")
}

describe("read-only specialists stay task-denied but subagent-spawnable", () => {
  test("merovingian denies task delegation but no longer denies subagent", () => {
    //#given
    const agent = createMerovingianAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).not.toContain("subagent")
    expect(denied).toContain("task")
  })

  test("operator denies task delegation but no longer denies subagent", () => {
    //#given
    const agent = createOperatorAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).not.toContain("subagent")
    expect(denied).toContain("task")
  })

  test("trinity denies task delegation but no longer denies subagent", () => {
    //#given
    const agent = createTrinityAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).not.toContain("subagent")
    expect(denied).toContain("task")
  })
})

describe("construct allows native subagent spawn (read-only intent preserved)", () => {
  test("construct allowlist includes subagent alongside read-only tools", () => {
    //#given
    const agent = createConstructAgent("test/model")
    //#when
    const allowed = allowedActions(agent.permissions)
    const denied = deniedActions(agent.permissions)
    //#then
    expect(allowed).toContain("subagent")
    expect(allowed).toContain("read")
    expect(denied).not.toContain("subagent")
  })
})

describe("mouse no longer blocks native subagent spawn", () => {
  test("mouse permissions carry no subagent deny", () => {
    //#given
    const agent = createMouseAgentWithOverrides(undefined, "test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).not.toContain("subagent")
  })
})
