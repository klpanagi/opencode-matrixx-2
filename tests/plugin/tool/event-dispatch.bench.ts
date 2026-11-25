/**
 * T3 (P2a) bench for the event dispatch index.
 *
 * Before: `dispatchToHooks` awaited 17 hook `event` handlers per event in
 * source order, so every `message.updated` paid ~17 serial no-op awaits.
 * After: the handler compiles an event-type -> hook index at registration
 * time, runs READ_ONLY observers in one `Promise.allSettled` wave, and keeps
 * the MUTATOR/BLOCKING chain sequential.
 *
 * Each stub reproduces the same event-type guard the real no-op handlers run
 * before they return, so the timing measures the work the index removes. Both
 * fixtures run the same outer wrapper (idle-dedupe prune + status normalizer)
 * and differ only in the dispatch chain: the legacy one is the pre-T3 chain
 * captured at this commit, the new one is the real `createEventHandler`
 * handler. Wall-clock numbers are host dependent, so the host-independent gate
 * is the invocation counts: hooks that do not observe `message.updated` must
 * run zero times on the new path and once per dispatch on the legacy path.
 *
 * Run with: `bun test ./tests/plugin/tool/event-dispatch.bench.ts`
 */
import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "../../../src/config"
import { handleKnowledgeHubEvent } from "../../../src/plugin/message-hooks/knowledge-hub-injector"
import type { DomainHooks, DomainManagers } from "../../../src/plugin/setup-domains"
import type { V2Event } from "../../../src/plugin/tool/context"
import { createEventHandler } from "../../../src/plugin/tool/event"
import { DEDUPLICATE_WINDOW_MS } from "../../../src/plugin/tool/event-dispatch"
import { pruneRecentSyntheticIdles } from "../../../src/plugin/tool/recent-synthetic-idles"
import { normalizeSessionStatusToIdle } from "../../../src/plugin/tool/session-status-normalizer"
import { formatTimingStats, timeAsync } from "../../perf/bench-utils"

const ITERS = 200
// Streaming fires message.updated in bursts; sampling a burst instead of a
// single event keeps the p50 resolution fine enough for the ratio gate.
const BURST = 25
// Alternating rounds keep a concurrently loaded host from deciding the gate.
const ROUNDS = 3
const SESSION_ID = "ses_event_dispatch_bench"

const ALL_HOOKS = [
  "autoUpdateChecker",
  "sessionNotification",
  "nudgeLoopBreaker",
  "contextWindowMonitor",
  "directoryAgentsInjector",
  "rulesInjector",
  "thinkMode",
  "contextWindowLimitRecovery",
  "agentUsageReminder",
  "categorySkillReminder",
  "interactiveBashSession",
  "matrixLoop",
  "stopContinuationGuard",
  "niobeHook",
  "planPersister",
  "runtimeFallback",
  "sessionMemory",
] as const

type HookName = (typeof ALL_HOOKS)[number]
type Counts = Record<HookName, number>
type Stubs = Record<string, unknown>

/** Events each hook's own `event` handler reads, mirroring the source. */
const HOOK_EVENT_TYPES: Record<HookName, readonly string[]> = {
  autoUpdateChecker: ["session.created"],
  sessionNotification: [
    "session.created",
    "session.idle",
    "message.updated",
    "tool.execute.before",
    "tool.execute.after",
    "session.deleted",
  ],
  nudgeLoopBreaker: ["message.updated", "session.next.step.ended", "session.next.step.failed"],
  contextWindowMonitor: ["session.deleted", "message.updated"],
  directoryAgentsInjector: ["session.deleted", "session.compacted"],
  rulesInjector: ["session.deleted", "session.compacted"],
  thinkMode: ["session.deleted"],
  contextWindowLimitRecovery: ["session.deleted", "session.error", "message.updated", "session.idle"],
  agentUsageReminder: ["session.deleted", "session.compacted"],
  categorySkillReminder: ["session.deleted", "session.compacted"],
  interactiveBashSession: ["session.deleted"],
  matrixLoop: ["session.idle", "session.deleted", "session.error"],
  stopContinuationGuard: ["session.deleted"],
  niobeHook: [
    "session.error",
    "session.idle",
    "message.updated",
    "message.part.updated",
    "tool.execute.before",
    "tool.execute.after",
    "session.deleted",
    "session.compacted",
  ],
  planPersister: ["session.idle", "session.compacted"],
  runtimeFallback: [
    "session.created",
    "session.deleted",
    "session.stop",
    "message.updated",
    "session.idle",
    "session.status",
    "session.error",
  ],
  sessionMemory: ["session.idle", "session.compacted"],
}

const MESSAGE_UPDATED_HOOKS = new Set<HookName>(
  ALL_HOOKS.filter((name) => HOOK_EVENT_TYPES[name].includes("message.updated")),
)

function createCounts(): Counts {
  return Object.fromEntries(ALL_HOOKS.map((name) => [name, 0])) as Counts
}

function createStubs(counts: Counts): Stubs {
  const guarded = (name: HookName) =>
    async (event: V2Event): Promise<void> => {
      if (!HOOK_EVENT_TYPES[name].some((type) => type === event.type)) return
      counts[name] += 1
    }

  return {
    autoUpdateChecker: { event: guarded("autoUpdateChecker") },
    sessionNotification: guarded("sessionNotification"),
    nudgeLoopBreaker: { event: guarded("nudgeLoopBreaker") },
    contextWindowMonitor: { event: guarded("contextWindowMonitor") },
    directoryAgentsInjector: { event: guarded("directoryAgentsInjector") },
    rulesInjector: { event: guarded("rulesInjector") },
    thinkMode: { event: guarded("thinkMode") },
    contextWindowLimitRecovery: { event: guarded("contextWindowLimitRecovery") },
    agentUsageReminder: { event: guarded("agentUsageReminder") },
    categorySkillReminder: { event: guarded("categorySkillReminder") },
    interactiveBashSession: { event: guarded("interactiveBashSession") },
    matrixLoop: { event: guarded("matrixLoop") },
    stopContinuationGuard: { event: guarded("stopContinuationGuard") },
    niobeHook: { handler: guarded("niobeHook") },
    planPersister: { event: guarded("planPersister") },
    runtimeFallback: { event: guarded("runtimeFallback") },
    sessionMemory: { event: guarded("sessionMemory") },
  }
}

function messageUpdated(): V2Event {
  return {
    type: "message.updated",
    data: { info: { sessionID: SESSION_ID, role: "assistant", finish: false } },
  }
}

function legacyDispatch(stubs: Stubs, event: V2Event): Promise<void> {
  const hook = stubs as Record<
    string,
    { event?: (event: V2Event) => Promise<void> } | ((event: V2Event) => Promise<void>) | undefined
  >
  const handler = stubs as Record<string, { handler?: (event: V2Event) => Promise<void> } | undefined>
  return (async () => {
    await Promise.resolve(hook.autoUpdateChecker?.event?.(event))
    await Promise.resolve((hook.sessionNotification as ((event: V2Event) => Promise<void>) | undefined)?.(event))
    await Promise.resolve(hook.nudgeLoopBreaker?.event?.(event))
    await Promise.resolve(hook.contextWindowMonitor?.event?.(event))
    await Promise.resolve(hook.directoryAgentsInjector?.event?.(event))
    await Promise.resolve(hook.rulesInjector?.event?.(event))
    handleKnowledgeHubEvent(event)
    await Promise.resolve(hook.thinkMode?.event?.(event))
    await Promise.resolve(hook.contextWindowLimitRecovery?.event?.(event))
    await Promise.resolve(hook.agentUsageReminder?.event?.(event))
    await Promise.resolve(hook.categorySkillReminder?.event?.(event))
    await Promise.resolve(hook.interactiveBashSession?.event?.(event))
    await Promise.resolve(hook.matrixLoop?.event?.(event))
    await Promise.resolve(hook.stopContinuationGuard?.event?.(event))
    await Promise.resolve(handler.niobeHook?.handler?.(event))
    await Promise.resolve(hook.planPersister?.event?.(event))
    await Promise.resolve(hook.runtimeFallback?.event?.(event))
    await Promise.resolve(hook.sessionMemory?.event?.(event))
  })()
}

/** The pre-T3 handler: same outer wrapper as `createEventHandler`, legacy chain. */
function createLegacyHandler(stubs: Stubs) {
  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()
  return async (event: V2Event): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUPLICATE_WINDOW_MS,
    })
    await legacyDispatch(stubs, event)
    normalizeSessionStatusToIdle(event)
  }
}

function createIndexedHandler(stubs: Stubs) {
  return createEventHandler({
    ctx: {} as unknown as Parameters<typeof createEventHandler>[0]["ctx"],
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: { markSessionCreated: () => {}, clear: () => {} },
    managers: {} as unknown as DomainManagers,
    hooks: stubs as unknown as DomainHooks,
  })
}

describe("event dispatch index", () => {
  test("message.updated p50 drops at least 10% and skipped hooks are never invoked", async () => {
    //#given - identical stub domains for the legacy and indexed dispatchers
    const legacyCounts = createCounts()
    const indexedCounts = createCounts()
    const legacyStubs = createStubs(legacyCounts)
    const indexedStubs = createStubs(indexedCounts)
    const legacyHandler = createLegacyHandler(legacyStubs)
    const indexedHandler = createIndexedHandler(indexedStubs)
    const event = messageUpdated()

    //#when - both chains are sampled over bursts, in alternating rounds
    const burst = async (dispatch: () => Promise<void>): Promise<void> => {
      for (let index = 0; index < BURST; index += 1) await dispatch()
    }
    let before = await timeAsync(() => burst(() => legacyHandler(event)), ITERS)
    let after = await timeAsync(() => burst(() => indexedHandler(event)), ITERS)
    for (let round = 1; round < ROUNDS; round += 1) {
      const nextBefore = await timeAsync(() => burst(() => legacyHandler(event)), ITERS)
      const nextAfter = await timeAsync(() => burst(() => indexedHandler(event)), ITERS)
      if (nextBefore.p50 < before.p50) before = nextBefore
      if (nextAfter.p50 < after.p50) after = nextAfter
    }
    console.log(formatTimingStats("event dispatch legacy", before))
    console.log(formatTimingStats("event dispatch indexed", after))

    //#then - timing gate
    expect(after.p50).toBeLessThan(before.p50 * 0.9)

    //#then - host-independent gate: non-observing hooks are never invoked
    for (const name of ALL_HOOKS) {
      if (MESSAGE_UPDATED_HOOKS.has(name)) {
        expect(legacyCounts[name]).toBeGreaterThan(0)
        expect(indexedCounts[name]).toBeGreaterThan(0)
        continue
      }
      expect(legacyCounts[name]).toBe(0)
      expect(indexedCounts[name]).toBe(0)
    }
  })
})
