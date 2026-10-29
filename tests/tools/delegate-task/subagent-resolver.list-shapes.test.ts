import { describe, expect, it } from "bun:test"
import type { ExecutorContext } from "../../../src/tools/delegate-task/executor-types"
import { resolveSubagentExecution } from "../../../src/tools/delegate-task/subagent-resolver"
import type { DelegateTaskArgs } from "../../../src/tools/delegate-task/types"

function createArgs(overrides?: Partial<DelegateTaskArgs>): DelegateTaskArgs {
  return {
    description: "Run review",
    prompt: "Review the current changes",
    run_in_background: false,
    load_skills: [],
    subagent_type: "oracle",
    ...overrides,
  }
}

function createCtx(agentsFn: () => Promise<unknown>): ExecutorContext {
  return {
    client: { app: { agents: agentsFn } },
    manager: {},
    directory: "/tmp/test",
  } as unknown as ExecutorContext
}

describe("resolveSubagentExecution list shapes", () => {
  it("resolves oracle from a located envelope without throwing", () => {
    //#given
    const ctx = createCtx(async () => ({
      location: { directory: "/tmp" },
      data: [{ name: "oracle", mode: "subagent" }],
    }))

    //#when
    const result = resolveSubagentExecution(createArgs(), ctx, "morpheus", "deep")

    //#then
    return expect(result).resolves.toMatchObject({ agentToUse: "oracle" })
  })

  it("resolves oracle from a plain array", () => {
    //#given
    const ctx = createCtx(async () => [{ name: "oracle", mode: "subagent" }])

    //#when
    const result = resolveSubagentExecution(createArgs(), ctx, "morpheus", "deep")

    //#then
    return expect(result).resolves.toMatchObject({ agentToUse: "oracle" })
  })

  it("returns a typed error for null without throwing", () => {
    //#given
    const ctx = createCtx(async () => null)

    //#when
    const result = resolveSubagentExecution(createArgs(), ctx, "morpheus", "deep")

    //#then
    return expect(result).resolves.toMatchObject({ agentToUse: "" })
  })

  it("returns an Available-agents error for a nonsense string without throwing", () => {
    //#given
    const ctx = createCtx(async () => "nonsense")

    //#when
    const result = resolveSubagentExecution(createArgs(), ctx, "morpheus", "deep")

    //#then
    return expect(result).resolves.toMatchObject({
      agentToUse: "",
      error: expect.stringContaining("Available agents"),
    })
  })

  it("returns an Unknown-agent error for an empty data envelope", () => {
    //#given
    const ctx = createCtx(async () => ({ data: [] }))

    //#when
    const result = resolveSubagentExecution(createArgs(), ctx, "morpheus", "deep")

    //#then
    return expect(result).resolves.toMatchObject({
      agentToUse: "",
      error: expect.stringContaining("Unknown agent"),
    })
  })
})
