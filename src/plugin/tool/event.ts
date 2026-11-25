import type { MatrixxConfig } from "../../config"
import { invalidateSdkMessageCache } from "../../features/context-injection/hook-bridge"
import {
  clearMainSession,
  clearSessionAgent,
  getMainSessionID,
  isMainSessionCandidate,
  registerSubagentSession,
  resetSessionStateForDispose,
  setMainSession,
  unregisterSubagentSession,
  updateSessionAgent,
} from "../../features/session-state/state"
import { resetMessageCursor } from "../../shared"
import { log } from "../../shared/runtime/logger"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { lspManager } from "../../tools"
import { handleKnowledgeHubEvent } from "../message-hooks/knowledge-hub-injector"
import type { DomainHooks, DomainManagers } from "../setup-domains"
import type { MatrixxContext, V2Event } from "./context"
import { DEDUPLICATE_WINDOW_MS } from "./event-dispatch"
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
  clear: (sessionID: string) => void
}

// Bumped by resetAllSessionState(); each live handler discards its idle-dedupe
// memory when it observes a new generation, so a disposed plugin keeps none.
let idleDedupGeneration = 0

/** Clear session identity state and idle-dedupe memory on plugin dispose. */
export function resetAllSessionState(): void {
  resetSessionStateForDispose()
  idleDedupGeneration += 1
}

type EventHookHandler = (event: V2Event) => Promise<void> | void

type EventHookDefinition = {
  readonly name: string
  readonly classification: "read-only" | "ordered"
  /**
   * Types the hook reacts to inside its own `event` handler, or `"all"` when
   * the handler runs a per-event state bootstrap before its type switch.
   */
  readonly eventTypes: readonly string[] | "all"
  readonly resolve: () => EventHookHandler | null | undefined
}

type IndexedEventHook = {
  readonly name: string
  readonly eventTypes: readonly string[] | "all"
  readonly invoke: EventHookHandler
}

type EventHookBucket = {
  readonly readOnly: readonly IndexedEventHook[]
  readonly ordered: readonly IndexedEventHook[]
}

const knowledgeHubEventHandler: EventHookHandler = (event) => {
  handleKnowledgeHubEvent(event)
}

function logRejectedObserver(hook: string | undefined, event: V2Event, error: unknown): void {
  log("[plugin:event] read-only hook rejected", { hook, type: event.type, error })
}

/** Observers never reject: a read-only failure is logged, never allowed to
 * abort its siblings or the mutating chain. */
async function invokeObserver(hook: IndexedEventHook, event: V2Event): Promise<void> {
  try {
    await hook.invoke(event)
  } catch (error) {
    logRejectedObserver(hook.name, event, error)
  }
}

/**
 * Every hook `dispatchToHooks` runs, listed in the pre-index source order.
 * Classification follows `hook-mutation-classification.md`: `read-only`
 * hooks only touch hook-private in-memory state, so their relative order is
 * free; `ordered` hooks write shared state, dispatch prompts, or emit files
 * and must keep their original order relative to each other.
 */
function eventHookDefinitions(hooks: DomainHooks): readonly EventHookDefinition[] {
  return [
    {
      name: "autoUpdateChecker",
      classification: "read-only",
      eventTypes: ["session.created"],
      resolve: () => hooks.autoUpdateChecker?.event,
    },
    {
      name: "sessionNotification",
      classification: "read-only",
      eventTypes: [
        "session.created",
        "session.idle",
        "message.updated",
        "tool.execute.before",
        "tool.execute.after",
        "session.deleted",
      ],
      resolve: () => hooks.sessionNotification,
    },
    {
      name: "nudgeLoopBreaker",
      classification: "ordered",
      eventTypes: "all",
      resolve: () => hooks.nudgeLoopBreaker?.event,
    },
    {
      name: "contextWindowMonitor",
      classification: "read-only",
      eventTypes: ["session.deleted", "message.updated"],
      resolve: () => hooks.contextWindowMonitor?.event,
    },
    {
      name: "directoryAgentsInjector",
      classification: "read-only",
      eventTypes: ["session.deleted", "session.compacted"],
      resolve: () => hooks.directoryAgentsInjector?.event,
    },
    {
      name: "rulesInjector",
      classification: "read-only",
      eventTypes: ["session.deleted", "session.compacted"],
      resolve: () => hooks.rulesInjector?.event,
    },
    {
      name: "knowledgeHub",
      classification: "ordered",
      eventTypes: ["session.deleted", "session.compacted"],
      resolve: () => knowledgeHubEventHandler,
    },
    {
      name: "thinkMode",
      classification: "read-only",
      eventTypes: ["session.deleted"],
      resolve: () => hooks.thinkMode?.event,
    },
    {
      name: "contextWindowLimitRecovery",
      classification: "ordered",
      eventTypes: ["session.deleted", "session.error", "message.updated", "session.idle"],
      resolve: () => hooks.contextWindowLimitRecovery?.event,
    },
    {
      name: "agentUsageReminder",
      classification: "read-only",
      eventTypes: ["session.deleted", "session.compacted"],
      resolve: () => hooks.agentUsageReminder?.event,
    },
    {
      name: "categorySkillReminder",
      classification: "read-only",
      eventTypes: ["session.deleted", "session.compacted"],
      resolve: () => hooks.categorySkillReminder?.event,
    },
    {
      name: "interactiveBashSession",
      classification: "ordered",
      eventTypes: ["session.deleted"],
      resolve: () => hooks.interactiveBashSession?.event,
    },
    {
      name: "matrixLoop",
      classification: "ordered",
      eventTypes: ["session.idle", "session.deleted", "session.error"],
      resolve: () => hooks.matrixLoop?.event,
    },
    {
      name: "stopContinuationGuard",
      classification: "read-only",
      eventTypes: ["session.deleted"],
      resolve: () => hooks.stopContinuationGuard?.event,
    },
    {
      name: "niobeHook",
      classification: "ordered",
      eventTypes: [
        "session.error",
        "session.idle",
        "message.updated",
        "message.part.updated",
        "tool.execute.before",
        "tool.execute.after",
        "session.deleted",
        "session.compacted",
      ],
      resolve: () => hooks.niobeHook?.handler,
    },
    {
      name: "planPersister",
      classification: "ordered",
      eventTypes: ["session.idle", "session.compacted"],
      resolve: () => hooks.planPersister?.event,
    },
    {
      name: "runtimeFallback",
      classification: "ordered",
      eventTypes: [
        "session.created",
        "session.deleted",
        "session.stop",
        "message.updated",
        "session.idle",
        "session.status",
        "session.error",
      ],
      resolve: () => hooks.runtimeFallback?.event,
    },
    {
      name: "sessionMemory",
      classification: "ordered",
      eventTypes: ["session.idle", "session.compacted"],
      resolve: () => hooks.sessionMemory?.event,
    },
  ]
}

/** Compile the event-type -> applicable-hook index once, at registration. */
function createEventHookIndex(hooks: DomainHooks): { forType: (type: string) => EventHookBucket } {
  const definitions = eventHookDefinitions(hooks)
  const all: { readOnly: IndexedEventHook[]; ordered: IndexedEventHook[] } = {
    readOnly: [],
    ordered: [],
  }
  const absent = new Set<string>()

  for (const definition of definitions) {
    const handler = definition.resolve()
    if (!handler) {
      absent.add(definition.name)
      continue
    }
    const hook: IndexedEventHook = {
      name: definition.name,
      eventTypes: definition.eventTypes,
      invoke: handler,
    }
    if (definition.classification === "read-only") all.readOnly.push(hook)
    else all.ordered.push(hook)
  }

  const knownTypes = new Set<string>()
  for (const definition of definitions) {
    if (absent.has(definition.name)) continue
    if (definition.eventTypes === "all") continue
    for (const type of definition.eventTypes) knownTypes.add(type)
  }

  const appliesTo = (hook: IndexedEventHook, type: string): boolean =>
    hook.eventTypes === "all" || hook.eventTypes.includes(type)

  const buckets = new Map<string, EventHookBucket>()
  for (const type of knownTypes) {
    buckets.set(type, {
      readOnly: all.readOnly.filter((hook) => appliesTo(hook, type)),
      ordered: all.ordered.filter((hook) => appliesTo(hook, type)),
    })
  }

  return {
    forType: (type) => buckets.get(type) ?? all,
  }
}

export function createEventHandler(args: {
  ctx: MatrixxContext & NativePluginContext
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  managers: DomainManagers
  hooks: DomainHooks
}): (event: V2Event) => Promise<void> {
  const { ctx, firstMessageVariantGate, hooks } = args

  const eventHookIndex = createEventHookIndex(hooks)
  let cachedType: string | undefined
  let cachedBucket = eventHookIndex.forType("")

  // Event streams arrive in bursts of one type (message.updated, session.idle),
  // so the last bucket is cached and skips the map lookup entirely.
  const bucketFor = (type: string): EventHookBucket => {
    if (type !== cachedType) {
      cachedType = type
      cachedBucket = eventHookIndex.forType(type)
    }
    return cachedBucket
  }

  const dispatchToHooks = async (event: V2Event): Promise<void> => {
    const bucket = bucketFor(event.type)

    const observers = bucket.readOnly
    if (observers.length <= 1) {
      const observer = observers[0]
      if (observer) await invokeObserver(observer, event)
    } else {
      await Promise.all(observers.map((hook) => invokeObserver(hook, event)))
    }

    for (const hook of bucket.ordered) {
      await hook.invoke(event)
    }
  }


  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()
  let dedupDroppedTotal = 0
  let observedIdleDedupGeneration = idleDedupGeneration

  const pruneIdleDedupe = (): void => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUPLICATE_WINDOW_MS,
    })
  }

  return async (event: V2Event): Promise<void> => {
    if (observedIdleDedupGeneration !== idleDedupGeneration) {
      recentSyntheticIdles.clear()
      recentRealIdles.clear()
      dedupDroppedTotal = 0
      observedIdleDedupGeneration = idleDedupGeneration
    }
    pruneIdleDedupe()

    if (event.type === "session.idle") {
      const idleData = event.data as Record<string, unknown> | undefined
      const sessionID = idleData?.sessionID as string | undefined
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID)
        if (emittedAt && Date.now() - emittedAt < DEDUPLICATE_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID)
          dedupDroppedTotal += 1
          log("[plugin:event] session.idle dedup dropped: synthetic idle wins", {
            sessionID,
            timestamp: new Date().toISOString(),
            windowMsRemaining:
              DEDUPLICATE_WINDOW_MS - (Date.now() - emittedAt),
            dedup_dropped_total: dedupDroppedTotal,
            ...(typeof idleData?.taskId === "string"
              ? { taskId: idleData.taskId }
              : {}),
          })
          return
        }
        pruneIdleDedupe()
        recentRealIdles.set(sessionID, Date.now())
        log("[plugin:event] session.idle dedup kept: dispatching real idle", {
          sessionID,
          timestamp: new Date().toISOString(),
        })
      }
    }

    await dispatchToHooks(event)

    const syntheticIdle = normalizeSessionStatusToIdle(event)
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.data as Record<string, unknown>)?.sessionID as string
      const emittedAt = recentRealIdles.get(sessionID)
      if (emittedAt && Date.now() - emittedAt < DEDUPLICATE_WINDOW_MS) {
        recentRealIdles.delete(sessionID)
        dedupDroppedTotal += 1
        log("[plugin:event] session.idle dedup dropped: real idle wins", {
          sessionID,
          timestamp: new Date().toISOString(),
          windowMsRemaining:
            DEDUPLICATE_WINDOW_MS - (Date.now() - emittedAt),
          dedup_dropped_total: dedupDroppedTotal,
        })
        return
      }
      pruneIdleDedupe()
      recentSyntheticIdles.set(sessionID, Date.now())
      await dispatchToHooks(syntheticIdle)
    }

    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string; metadata?: Record<string, unknown> }
        | undefined

      if (isMainSessionCandidate(sessionInfo)) {
        setMainSession(sessionInfo?.id)
      }

      if (sessionInfo?.id && sessionInfo.parentID) {
        registerSubagentSession(sessionInfo.id, sessionInfo.parentID)
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo)
      // D5: native session APIs own subagent display; no tmux mirror.
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined

      if (sessionInfo?.id) {
        unregisterSubagentSession(sessionInfo.id)
        clearMainSession(sessionInfo.id)
        clearSessionAgent(sessionInfo.id)
        resetMessageCursor(sessionInfo.id)
        invalidateSdkMessageCache(sessionInfo.id)
        firstMessageVariantGate.clear(sessionInfo.id)
        await lspManager.cleanupTempDirectoryClients()
        // D5: native session APIs own subagent display; no tmux mirror.
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined
      const role = info?.role as string | undefined
      if (sessionID && agent && role === "user") {
        updateSessionAgent(sessionID, agent)
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error

      if (hooks.sessionRecovery?.isRecoverableError(error)) {
        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        }
        const recovered = await hooks.sessionRecovery.handleSessionRecovery(messageInfo)

        if (
          recovered &&
          sessionID &&
          sessionID === getMainSessionID() &&
          !hooks.stopContinuationGuard?.isStopped(sessionID)
        ) {
          await ctx.session
            .prompt({
              sessionID,
              parts: [{ type: "text", text: "continue" }],
            })
            .catch((err) => { log("[plugin] Session prompt failed:", err) })
        }
      }
    }
  }
}
