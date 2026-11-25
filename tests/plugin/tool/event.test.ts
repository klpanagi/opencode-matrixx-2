/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../../../src/config"
import { _resetForTesting } from "../../../src/features/session-state/state"
import type { DomainHooks, DomainManagers } from "../../../src/plugin/setup-domains"
import type { V2Event } from "../../../src/plugin/tool/context"
import { createEventHandler } from "../../../src/plugin/tool/event"

/**
 * T3 (P2a) event dispatch index.
 *
 * `createEventHandler` used to await 17 hook `event` handlers per event in
 * source order, so a `message.updated` paid ~17 serial no-op awaits. The
 * handler now compiles an event-type -> hook index at registration time:
 *   - hooks that do not observe the type are skipped entirely,
 *   - READ_ONLY observers run in one `Promise.allSettled` wave,
 *   - MUTATOR/BLOCKING hooks keep their original relative order.
 *
 * These tests pin those three properties; `event.main-session.test.ts` keeps
 * the session-identity behaviour pinned.
 */

const SESSION_ID = "ses_event_index"

type HookStub = { event: (event: V2Event) => Promise<void> | void }

function buildHooks(calls: string[], options: { failing?: readonly string[] } = {}): DomainHooks {
  const failing = new Set(options.failing ?? [])
  const record = (name: string) => {
    calls.push(name)
    if (failing.has(name)) throw new Error(`${name} rejected`)
  }
  const stub = (name: string): HookStub => ({ event: () => record(name) })

  return {
    autoUpdateChecker: stub("autoUpdateChecker"),
    sessionNotification: () => record("sessionNotification"),
    nudgeLoopBreaker: stub("nudgeLoopBreaker"),
    contextWindowMonitor: stub("contextWindowMonitor"),
    directoryAgentsInjector: stub("directoryAgentsInjector"),
    rulesInjector: stub("rulesInjector"),
    thinkMode: stub("thinkMode"),
    contextWindowLimitRecovery: stub("contextWindowLimitRecovery"),
    agentUsageReminder: stub("agentUsageReminder"),
    categorySkillReminder: stub("categorySkillReminder"),
    interactiveBashSession: stub("interactiveBashSession"),
    matrixLoop: stub("matrixLoop"),
    stopContinuationGuard: stub("stopContinuationGuard"),
    niobeHook: { handler: () => record("niobeHook") },
    planPersister: stub("planPersister"),
    runtimeFallback: stub("runtimeFallback"),
    sessionMemory: stub("sessionMemory"),
  } as unknown as DomainHooks
}

function buildHandler(calls: string[], options: { failing?: readonly string[] } = {}) {
  return createEventHandler({
    ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: {
      markSessionCreated: () => {},
      clear: () => {},
    },
    managers: {} as unknown as DomainManagers,
    hooks: buildHooks(calls, options),
  })
}

function messageUpdated(sessionID = SESSION_ID): V2Event {
  return {
    type: "message.updated",
    data: { info: { sessionID, role: "assistant", finish: false } },
  }
}

function sessionIdle(sessionID = SESSION_ID): V2Event {
  return { type: "session.idle", data: { sessionID } }
}

function sessionDeleted(sessionID = SESSION_ID): V2Event {
  return { type: "session.deleted", data: { info: { id: sessionID } } }
}

const ORDERED_HOOKS = [
  "nudgeLoopBreaker",
  "contextWindowLimitRecovery",
  "interactiveBashSession",
  "matrixLoop",
  "niobeHook",
  "planPersister",
  "runtimeFallback",
  "sessionMemory",
] as const

describe("createEventHandler - event-type hook index", () => {
  test("skips hooks that do not observe message.updated", async () => {
    //#given
    _resetForTesting()
    const calls: string[] = []
    const handler = buildHandler(calls)

    //#when - a common streaming event is dispatched
    await handler(messageUpdated())

    //#then - only the hooks that read message.updated ran
    expect([...calls].sort()).toEqual([
      "contextWindowLimitRecovery",
      "contextWindowMonitor",
      "niobeHook",
      "nudgeLoopBreaker",
      "runtimeFallback",
      "sessionNotification",
    ])
  })

  test("keeps mutating hooks in their original relative order", async () => {
    //#given
    _resetForTesting()
    const calls: string[] = []
    const handler = buildHandler(calls)

    //#when - session.idle fan-outs into seven mutating hooks
    await handler(sessionIdle())

    //#then - the mutators still run sequentially in the pre-index order
    const ordered = calls.filter((call) => (ORDERED_HOOKS as readonly string[]).includes(call))
    expect(ordered).toEqual([
      "nudgeLoopBreaker",
      "contextWindowLimitRecovery",
      "matrixLoop",
      "niobeHook",
      "planPersister",
      "runtimeFallback",
      "sessionMemory",
    ])
  })

  test("runs read-only observers concurrently", async () => {
    //#given - two read-only observers that only resolve once both are inside
    _resetForTesting()
    let entered = 0
    let releaseBoth: () => void = () => {}
    const bothEntered = new Promise<void>((resolve) => {
      releaseBoth = resolve
    })
    const gated = (name: string, calls: string[]): HookStub => ({
      event: async () => {
        calls.push(name)
        entered += 1
        if (entered === 2) releaseBoth()
        await bothEntered
      },
    })
    const calls: string[] = []
    const hooks = buildHooks(calls) as unknown as Record<string, unknown>
    hooks.sessionNotification = gated("sessionNotification", calls).event
    hooks.contextWindowMonitor = gated("contextWindowMonitor", calls)
    const handler = createEventHandler({
      ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
      pluginConfig: {} as unknown as MatrixxConfig,
      firstMessageVariantGate: { markSessionCreated: () => {}, clear: () => {} },
      managers: {} as unknown as DomainManagers,
      hooks: hooks as unknown as DomainHooks,
    })

    //#when - dispatching would deadlock if the observers ran one after another
    const outcome = await Promise.race([
      handler(messageUpdated()).then(() => "dispatched" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 500)),
    ])

    //#then
    expect(outcome).toBe("dispatched")
    expect(calls).toContain("sessionNotification")
    expect(calls).toContain("contextWindowMonitor")
  })

  test("a rejected read-only observer does not abort the mutating chain", async () => {
    //#given - one observer throws on session.deleted
    _resetForTesting()
    const calls: string[] = []
    const handler = buildHandler(calls, { failing: ["categorySkillReminder"] })

    //#when
    await handler(sessionDeleted())

    //#then - the session teardown mutators still ran
    expect(calls).toContain("interactiveBashSession")
    expect(calls).toContain("matrixLoop")
    expect(calls).toContain("niobeHook")
  })

  test("falls back to every hook for an unrecognised event type", async () => {
    //#given
    _resetForTesting()
    const calls: string[] = []
    const handler = buildHandler(calls)

    //#when - a type the index has never classified arrives
    await handler({ type: "session.unknown.event", data: { sessionID: SESSION_ID } })

    //#then - the pre-index behaviour is preserved: every hook is invoked
    expect([...calls].sort()).toEqual([
      "agentUsageReminder",
      "autoUpdateChecker",
      "categorySkillReminder",
      "contextWindowLimitRecovery",
      "contextWindowMonitor",
      "directoryAgentsInjector",
      "interactiveBashSession",
      "matrixLoop",
      "niobeHook",
      "nudgeLoopBreaker",
      "planPersister",
      "rulesInjector",
      "runtimeFallback",
      "sessionMemory",
      "sessionNotification",
      "stopContinuationGuard",
      "thinkMode",
    ])
  })

  test("read-only observers settle before the mutating chain starts", async () => {
    //#given
    _resetForTesting()
    const calls: string[] = []
    const handler = buildHandler(calls)

    //#when
    await handler(sessionDeleted())

    //#then - the first mutator is strictly after every observer
    const firstMutator = calls.findIndex((call) => call === "nudgeLoopBreaker")
    const lastObserver = Math.max(
      calls.indexOf("sessionNotification"),
      calls.indexOf("contextWindowMonitor"),
      calls.indexOf("directoryAgentsInjector"),
      calls.indexOf("rulesInjector"),
      calls.indexOf("thinkMode"),
      calls.indexOf("agentUsageReminder"),
      calls.indexOf("categorySkillReminder"),
      calls.indexOf("stopContinuationGuard"),
    )
    expect(firstMutator).toBeGreaterThan(lastObserver)
  })

  test("hooks without an event handler are omitted from the index", async () => {
    //#given - a domain where rulesInjector has no event handler at all
    _resetForTesting()
    const calls: string[] = []
    const hooks = buildHooks(calls) as unknown as Record<string, unknown>
    hooks.rulesInjector = null
    const handler = createEventHandler({
      ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
      pluginConfig: {} as unknown as MatrixxConfig,
      firstMessageVariantGate: { markSessionCreated: () => {}, clear: () => {} },
      managers: {} as unknown as DomainManagers,
      hooks: hooks as unknown as DomainHooks,
    })

    //#when
    await handler(sessionDeleted())

    //#then - nothing to invoke, nothing awaited
    expect(calls).not.toContain("rulesInjector")
    expect(calls).toContain("thinkMode")
  })
})
