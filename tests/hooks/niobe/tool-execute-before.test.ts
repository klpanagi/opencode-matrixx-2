/// <reference types="bun-types" />

import { afterAll, describe, expect, mock, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/tool/context"

const ORCHESTRATOR_FLAG_KEY = "__niobeToolExecuteBeforeOrchestrator"

function setOrchestrator(value: boolean): void {
  ;(globalThis as unknown as Record<string, boolean>)[ORCHESTRATOR_FLAG_KEY] = value
}

setOrchestrator(true)

mock.module("../../../src/shared/session/session-utils", () => ({
  isCallerOrchestrator: async () =>
    (globalThis as unknown as Record<string, boolean>)[ORCHESTRATOR_FLAG_KEY] !== false,
}))

import { createToolExecuteBeforeHandler } from "../../../src/hooks/niobe/tool-execute-before"

afterAll(() => {
  mock.restore()
  setOrchestrator(true)
})

function makeHandler() {
  const ctx = { client: {} } as unknown as MatrixxContext
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

  test("orchestrator native subagent call passes through (no block)", async () => {
    // NOTE (Phase 5.3 inversion): native `subagent` is now THE delegation
    // path — the orchestrator hard-block was removed, prompt passes through.
    //#given: an orchestrator caller invoking the native subagent tool
    //#when: the guard runs
    const handler = makeHandler()
    const output = { args: { prompt: "do the thing" } }
    await handler({ tool: "subagent", sessionID: "ses_1", callID: "c1" }, output as never)
    //#then: no throw; prompt carries the single-task directive (isTaskTool match)
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

describe("niobe tool-execute-before native subagent pass-through", () => {
  // NOTE (Phase 5.3 inversion): hard-block removed — native subagent is THE path.
  test("orchestrator native subagent call is not blocked", async () => {
    //#given: an orchestrator caller invoking the native subagent tool
    setOrchestrator(true)
    const handler = makeHandler()
    const output = { args: { prompt: "do the thing", subagent_type: "sati" } }
    //#when: the guard runs
    await handler(
      { tool: "subagent", sessionID: "ses_1", callID: "c1" },
      output as never,
    )
    //#then: it resolves without throwing (prompt may carry the directive)
    expect(output.args.prompt as string).toContain("do the thing")
  })

  test("non-orchestrator native subagent call is not blocked", async () => {
    //#given: a non-orchestrator caller invoking the native subagent tool
    setOrchestrator(false)
    try {
      const handler = makeHandler()
      const output = { args: { prompt: "do the thing" } }
      //#when: the guard runs
      await handler({ tool: "subagent", sessionID: "ses_9", callID: "c9" }, output as never)
      //#then: it resolves to normal behavior without a redirect block (prompt untouched)
      expect(output.args.prompt as string).toBe("do the thing")
    } finally {
      setOrchestrator(true)
    }
  })

  test("orchestrator plugin task call still gets directive, not blocked", async () => {
    //#given: an orchestrator caller invoking the plugin task tool
    setOrchestrator(true)
    const handler = makeHandler()
    const output = { args: { prompt: "do the thing", category: "sati" } }
    //#when: the guard runs
    await handler({ tool: "task", sessionID: "ses_1", callID: "c1" }, output as never)
    //#then: it resolves with SINGLE_TASK_DIRECTIVE injection, not blocked
    expect(output.args.prompt as string).toContain("<system-reminder>")
  })
})
