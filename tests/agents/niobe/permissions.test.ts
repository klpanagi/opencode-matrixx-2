/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createNiobeAgent } from "../../../src/agents/niobe/agent"
import type { OrchestratorContext } from "../../../src/agents/niobe/agent"

type Rule = { action: string; resource: string; effect: string }

function permissionsOf(ctx: OrchestratorContext): Rule[] {
  const result = createNiobeAgent(ctx) as unknown as { permissions: Rule[] | undefined }
  return result.permissions === undefined ? [] : result.permissions
}

describe("niobe native-subagent deny (T5)", () => {
  test("baseConfig denies native subagent action", () => {
    //#given a fresh orchestrator context
    const ctx: OrchestratorContext = {}

    //#when the niobe agent config is created
    const permissions = permissionsOf(ctx)

    //#then a scoped deny ruleset blocks the native subagent tool
    expect(permissions).toContainEqual({
      action: "subagent",
      resource: "*",
      effect: "deny",
    })
  })

  test("baseConfig does not deny task delegation", () => {
    //#given a fresh orchestrator context
    const ctx: OrchestratorContext = {}

    //#when the niobe agent config is created
    const permissions = permissionsOf(ctx)

    //#then the plugin task() delegation path stays unaffected
    const denied = permissions.filter(function (r) { return r.action === "task" && r.effect === "deny" })
    expect(denied.length).toBe(0)
  })
})