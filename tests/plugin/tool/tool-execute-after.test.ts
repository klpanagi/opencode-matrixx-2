import { describe, expect, test } from "bun:test"

import type { DomainHooks } from "../../../src/plugin/setup-domains"
import { createToolExecuteAfterHandler } from "../../../src/plugin/tool/tool-execute-after"

type AfterInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: Record<string, unknown> }
type Stub = (input: AfterInput, output: AfterOutput) => Promise<void>

const LEADING = ["toolOutputTruncator", "qualityGate"] as const

// Hooks that replace `output.output` (or rewrite it from a pre-await snapshot)
// must stay sequential, in this order.
const MUTATORS = [
  "webfetchRedirectGuard",
  "emptyTaskResponseDetector",
  "niobeHook",
  "taskResumeInfo",
  "taskNotepadWriter",
  "hashlineReadEnhancer",
] as const

// Pure tail observer: it reads the finished output, so it runs last and alone.
const TAIL = ["sessionMemory"] as const

const OBSERVER_WAVES = [
  ["contextWindowMonitor", "commentChecker", "directoryAgentsInjector", "rulesInjector"],
  ["agentUsageReminder", "categorySkillReminder", "interactiveBashSession", "editErrorRecovery"],
  ["jsonErrorRecovery", "readImageResizer", "silentFailureGuard"],
] as const

const OBSERVERS = OBSERVER_WAVES.flat()
const ALL_HOOKS = [...LEADING, ...MUTATORS, ...OBSERVERS, ...TAIL]

function buildHooks(behaviours: Record<string, Stub>): DomainHooks {
  const hooks: Record<string, { "tool.execute.after": Stub }> = {}
  for (const name of ALL_HOOKS) {
    hooks[name] = { "tool.execute.after": behaviours[name] ?? (async () => {}) }
  }
  return hooks as unknown as DomainHooks
}

function dispatch(hooks: DomainHooks): Promise<void> {
  const handler = createToolExecuteAfterHandler({ hooks })
  return handler(
    { tool: "t4", sessionID: "ses_t4", callID: "call_t4" },
    { title: "t", output: "start", metadata: {} },
  )
}

describe("createToolExecuteAfterHandler wave grouping", () => {
  test("sequential hooks keep their order and never overlap", async () => {
    //#given every hook tracked, with sequential hooks suspending once
    const order: string[] = []
    let activeSequential = 0
    let maxActiveSequential = 0
    const behaviours: Record<string, Stub> = {}
    for (const name of [...LEADING, ...MUTATORS, ...TAIL]) {
      behaviours[name] = async () => {
        order.push(name)
        activeSequential++
        maxActiveSequential = Math.max(maxActiveSequential, activeSequential)
        await Promise.resolve()
        activeSequential--
      }
    }
    const hooks = buildHooks(behaviours)

    //#when the handler dispatches
    await dispatch(hooks)

    //#then the sequential subset ran in the source order, one at a time
    expect(order).toEqual([...LEADING, ...MUTATORS, ...TAIL])
    expect(maxActiveSequential).toBe(1)
  })

  test("observers overlap inside their wave", async () => {
    //#given observers that suspend for two microtasks while counting themselves
    const active = new Set<string>()
    let maxActive = 0
    const behaviours: Record<string, Stub> = {}
    for (const name of OBSERVERS) {
      behaviours[name] = async () => {
        active.add(name)
        maxActive = Math.max(maxActive, active.size)
        await Promise.resolve()
        await Promise.resolve()
        active.delete(name)
      }
    }
    const hooks = buildHooks(behaviours)

    //#when the handler dispatches
    await dispatch(hooks)

    //#then the widest wave had every member in flight at once
    expect(maxActive).toBe(Math.max(...OBSERVER_WAVES.map((wave) => wave.length)))
  })

  test("concurrent appends keep every reminder and the tail sees them", async () => {
    //#given observers that append a marker after suspending, and a capturing tail
    const behaviours: Record<string, Stub> = {}
    for (const name of OBSERVERS) {
      behaviours[name] = async (_input, output) => {
        await Promise.resolve()
        output.output += `|${name}`
      }
    }
    let seenByTail = ""
    behaviours.sessionMemory = async (_input, output) => {
      seenByTail = output.output
    }
    const hooks = buildHooks(behaviours)
    const handler = createToolExecuteAfterHandler({ hooks })
    const output = { title: "t", output: "start", metadata: {} }

    //#when the handler dispatches
    await handler({ tool: "t4", sessionID: "ses_t4", callID: "call_t4" }, output)

    //#then no append was lost to a read-modify-write race
    for (const name of OBSERVERS) expect(output.output).toContain(`|${name}`)
    //#then the sequential tail observed the finished text
    expect(seenByTail).toContain("|contextWindowMonitor")
    expect(seenByTail).toContain("|silentFailureGuard")
  })

  test("a throwing observer is isolated from its wave and from later mutators", async () => {
    //#given one observer that rejects
    const ran: string[] = []
    const behaviours: Record<string, Stub> = {}
    for (const name of ALL_HOOKS) {
      behaviours[name] = async () => {
        ran.push(name)
        if (name === "jsonErrorRecovery") throw new Error("observer exploded")
      }
    }
    const hooks = buildHooks(behaviours)

    //#when the handler dispatches
    const dispatchPromise = dispatch(hooks)

    //#then the rejection never escapes and every remaining hook still ran
    await expect(dispatchPromise).resolves.toBeUndefined()
    expect(new Set(ran)).toEqual(new Set(ALL_HOOKS))
  })
})
