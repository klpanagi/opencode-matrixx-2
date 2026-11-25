import { beforeEach, describe, expect, mock, test } from "bun:test"

type LogCall = { message: string; data?: unknown }

const logCalls: LogCall[] = []

mock.module("../../../src/shared/runtime/logger", () => ({
  log: (message: string, data?: unknown) => {
    logCalls.push({ message, data })
  },
  warn: () => {},
}))

import type { DomainHooks } from "../../../src/plugin/setup-domains"
import { createToolExecuteAfterHandler } from "../../../src/plugin/tool/tool-execute-after"

// Sequential chain order from before T4 — the isolation table must not reorder it.
const REMAINING_HOOKS = [
  "webfetchRedirectGuard",
  "contextWindowMonitor",
  "commentChecker",
  "directoryAgentsInjector",
  "rulesInjector",
  "emptyTaskResponseDetector",
  "agentUsageReminder",
  "categorySkillReminder",
  "interactiveBashSession",
  "editErrorRecovery",
  "niobeHook",
  "taskResumeInfo",
  "taskNotepadWriter",
  "hashlineReadEnhancer",
  "jsonErrorRecovery",
  "readImageResizer",
  "silentFailureGuard",
  "sessionMemory",
] as const

const REMAINING_HOOK_SET = new Set<string>(REMAINING_HOOKS)
const LEADING_HOOKS = ["toolOutputTruncator", "qualityGate"] as const

type AfterHook = () => Promise<void>

function buildHooks(record: string[], throwing: ReadonlySet<string>): DomainHooks {
  const hooks: Record<string, { "tool.execute.after": AfterHook }> = {}
  for (const name of [...LEADING_HOOKS, ...REMAINING_HOOKS]) {
    hooks[name] = {
      "tool.execute.after": async () => {
        record.push(name)
        if (throwing.has(name)) throw new Error(`${name} exploded`)
      },
    }
  }
  return hooks as unknown as DomainHooks
}

function remainingRecorded(record: string[]): string[] {
  return record.filter((name) => REMAINING_HOOK_SET.has(name))
}

function hookFailures(): LogCall[] {
  return logCalls.filter((call) => call.message.includes("tool.execute.after hook failed"))
}

function hookFailureSummary(): LogCall[] {
  return logCalls.filter((call) => call.message.includes("tool.execute.after hooks failed"))
}

beforeEach(() => {
  logCalls.length = 0
})

describe("createToolExecuteAfterHandler per-hook isolation", () => {
  test("a throwing hook does not cancel the hooks after it", async () => {
    //#given a hook chain where the third sequential hook throws
    const record: string[] = []
    const hooks = buildHooks(record, new Set(["commentChecker"]))
    const handler = createToolExecuteAfterHandler({ hooks })
    const input = { tool: "t4_isolation", sessionID: "ses_t4", callID: "call_t4" }
    const output = { title: "t", output: "o", metadata: {} }

    //#when the host dispatches tool.execute.after
    const dispatch = handler(input, output)

    //#then no rejection escapes and every hook slot was attempted
    await expect(dispatch).resolves.toBeUndefined()
    expect(remainingRecorded(record)).toEqual([...REMAINING_HOOKS])
    expect(record).toContain("toolOutputTruncator")
    expect(record).toContain("qualityGate")

    //#then exactly one per-hook failure was logged, naming the throwing hook
    const failures = hookFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data).toMatchObject({
      hook: "commentChecker",
      tool: "t4_isolation",
      error: "commentChecker exploded",
    })

    //#then one aggregate line reports the failure count and hook names
    const summaries = hookFailureSummary()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.data).toMatchObject({
      count: 1,
      hooks: ["commentChecker"],
      tool: "t4_isolation",
    })
  })

  test("a throwing qualityGate does not cancel the sequential chain", async () => {
    //#given qualityGate rejects
    const record: string[] = []
    const hooks = buildHooks(record, new Set(["qualityGate"]))
    const handler = createToolExecuteAfterHandler({ hooks })
    const input = { tool: "t4_quality_gate", sessionID: "ses_t4", callID: "call_qg" }
    const output = { title: "t", output: "o", metadata: {} }

    //#when the host dispatches tool.execute.after
    const dispatch = handler(input, output)

    //#then the rejection is isolated and the failure is logged by name
    await expect(dispatch).resolves.toBeUndefined()
    expect(remainingRecorded(record)).toEqual([...REMAINING_HOOKS])
    const failures = hookFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.data).toMatchObject({ hook: "qualityGate" })
  })

  test("a healthy chain logs no failure or summary lines", async () => {
    //#given every hook resolves
    const record: string[] = []
    const hooks = buildHooks(record, new Set())
    const handler = createToolExecuteAfterHandler({ hooks })
    const input = { tool: "t4_healthy", sessionID: "ses_t4", callID: "call_ok" }
    const output = { title: "t", output: "o", metadata: {} }

    //#when the host dispatches tool.execute.after
    await handler(input, output)

    //#then all hooks ran in the original order and nothing was reported as failed
    expect(remainingRecorded(record)).toEqual([...REMAINING_HOOKS])
    expect(hookFailures()).toHaveLength(0)
    expect(hookFailureSummary()).toHaveLength(0)
  })
})
