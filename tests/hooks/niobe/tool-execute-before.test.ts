/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

mock.module("../../../src/shared/session-utils", () => ({
  isCallerOrchestrator: async () => true,
}))

import { createToolExecuteBeforeHandler } from "../../../src/hooks/niobe/tool-execute-before"

function makeHandler() {
  const ctx = { client: {} } as unknown as PluginInput
  return createToolExecuteBeforeHandler({ ctx, pendingFilePaths: new Map() })
}

async function run(tool: string, args: Record<string, unknown>) {
  const handler = makeHandler()
  const output = { args }
  await handler({ tool, sessionID: "ses_1", callID: "c1" }, output as never)
  return output
}

describe("niobe tool-execute-before shell alias (V2)", () => {
  test("shell orchestrator mutation is blocked like bash", async () => {
    //#given: an orchestrator shell mutation outside .matrixx
    const handler = makeHandler()
    const output = { args: { command: "mkdir /tmp/orch-shell-probe" } }
    //#when: the guard runs
    const result = handler({ tool: "shell", sessionID: "ses_1", callID: "c1" }, output as never)
    //#then: it throws the delegation block
    await expect(result).rejects.toThrow("must delegate file mutations")
  })

  test("bash orchestrator mutation is still blocked (V1 compat)", async () => {
    //#given: an orchestrator bash mutation outside .matrixx
    const handler = makeHandler()
    const output = { args: { command: "mkdir /tmp/orch-bash-probe" } }
    //#when: the guard runs
    const result = handler({ tool: "bash", sessionID: "ses_1", callID: "c1" }, output as never)
    //#then: it throws the delegation block
    await expect(result).rejects.toThrow("must delegate file mutations")
  })

  test("subagent input gets the single-task directive like task", async () => {
    //#given: a subagent call without the directive prefix
    //#when: the guard runs
    const output = await run("subagent", { prompt: "do the thing" })
    //#then: the directive is prepended
    expect(output.args.prompt as string).toContain("<system-reminder>")
  })

  test("task input still gets the single-task directive (V1 compat)", async () => {
    //#given: a task call without the directive prefix
    //#when: the guard runs
    const output = await run("task", { prompt: "do the thing" })
    //#then: the directive is prepended
    expect(output.args.prompt as string).toContain("<system-reminder>")
  })
})
