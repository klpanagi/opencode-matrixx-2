/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { createMerovingianAgent } from "../../src/agents/definitions/merovingian"
import { createOperatorAgent } from "../../src/agents/definitions/operator"
import { createTrinityAgent } from "../../src/agents/definitions/trinity"

function deniedActions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return []
  return permissions
    .filter((rule) => typeof rule === "object" && rule !== null && (rule as { effect?: string }).effect === "deny")
    .map((rule) => (rule as { action?: string }).action ?? "")
}

describe("deny(subagent) agents stay permission-denied on spawn", () => {
  test("merovingian denies subagent and task spawn", () => {
    //#given
    const agent = createMerovingianAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).toContain("subagent")
    expect(denied).toContain("task")
  })

  test("operator denies subagent and task spawn", () => {
    //#given
    const agent = createOperatorAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).toContain("subagent")
    expect(denied).toContain("task")
  })

  test("trinity denies subagent and task spawn", () => {
    //#given
    const agent = createTrinityAgent("test/model")
    //#when
    const denied = deniedActions(agent.permissions)
    //#then
    expect(denied).toContain("subagent")
    expect(denied).toContain("task")
  })
})
