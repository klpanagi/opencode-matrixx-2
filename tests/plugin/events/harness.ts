import type { MatrixxConfig } from "../../../src/config"
import { createEventHandler } from "../../../src/plugin/event"
import type { V2Event } from "../../../src/plugin/context"
import type { DomainHooks, DomainManagers } from "../../../src/plugin/setup-domains"
import type { MatrixxContext } from "../../../src/plugin/context"

export type EventInput = V2Event
type EventFn = (event: V2Event) => Promise<void>

function inertEventHook(): { event: EventFn } {
  return { event: async () => {} }
}

function inertHandlerHook(): { handler: EventFn } {
  return { handler: async () => {} }
}

export function inertHooks(overrides: Record<string, unknown> = {}): DomainHooks {
  const hooks: Record<string, unknown> = {
    autoUpdateChecker: inertEventHook(),
    backgroundNotificationHook: inertEventHook(),
    sessionNotification: (async () => {}) as EventFn,
    taskContinuationEnforcer: inertHandlerHook(),
    unstableAgentBabysitter: inertEventHook(),
    nudgeLoopBreaker: inertEventHook(),
    contextWindowMonitor: inertEventHook(),
    directoryAgentsInjector: inertEventHook(),
    rulesInjector: inertEventHook(),
    knowledgeHubInjector: inertEventHook(),
    thinkMode: inertEventHook(),
    contextWindowLimitRecovery: inertEventHook(),
    agentUsageReminder: inertEventHook(),
    categorySkillReminder: inertEventHook(),
    interactiveBashSession: inertEventHook(),
    matrixLoop: inertEventHook(),
    stopContinuationGuard: { event: async () => {}, isStopped: () => false },
    niobeHook: inertHandlerHook(),
    planPersister: inertEventHook(),
    runtimeFallback: inertEventHook(),
    sessionMemory: inertEventHook(),
    sessionRecovery: {
      isRecoverableError: () => false,
      handleSessionRecovery: async () => false,
    },
    ...overrides,
  }
  return hooks as unknown as DomainHooks
}

export type DispatchRunOptions = {
  event: V2Event
  hooks?: Record<string, unknown>
  ctx?: Record<string, unknown>
  firstMessageVariantGate?: unknown
}

export type DispatchRunResult = { delivered: number }

export async function deliverThroughDispatch(options: DispatchRunOptions): Promise<DispatchRunResult> {
  const eventHandler = createEventHandler({
    ctx: (options.ctx ?? {
      directory: "/tmp",
      client: { session: { prompt: async () => ({}) } },
    }) as unknown as MatrixxContext,
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: (options.firstMessageVariantGate ?? {
      markSessionCreated: () => {},
      clear: () => {},
    }) as never,
    managers: {} as unknown as DomainManagers,
    hooks: inertHooks(options.hooks ?? {}),
  })

  await eventHandler(options.event)
  return { delivered: 1 }
}


export function recordingEventHook(received: V2Event[]): { event: EventFn } {
  return {
    event: async (event) => {
      received.push(event)
    },
  }
}

export function recordingHandlerHook(received: V2Event[]): { handler: EventFn } {
  return {
    handler: async (event) => {
      received.push(event)
    },
  }
}
