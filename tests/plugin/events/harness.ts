import type { MatrixxConfig } from "../../../src/config"
import { createEventHandler } from "../../../src/plugin/event"
import { createEventPump } from "../../../src/plugin/event-pump"
import { toV1Event } from "../../../src/plugin/opencode-events"
import type { DomainHooks, DomainManagers } from "../../../src/plugin/setup-domains"
import type { PluginContext } from "../../../src/plugin/types"

export type EventInput = { event: { type: string; properties?: Record<string, unknown> } }
type EventFn = (input: EventInput) => Promise<void>

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

export type PumpRunOptions = {
  event: EventInput["event"]
  hooks?: Record<string, unknown>
  ctx?: Record<string, unknown>
  firstMessageVariantGate?: unknown
}

export type PumpRunResult = { delivered: number }

export async function deliverThroughPump(options: PumpRunOptions): Promise<PumpRunResult> {
  const eventHandler = createEventHandler({
    ctx: (options.ctx ?? {
      directory: "/tmp",
      client: { session: { prompt: async () => ({}) } },
    }) as unknown as PluginContext,
    pluginConfig: {} as unknown as MatrixxConfig,
    firstMessageVariantGate: (options.firstMessageVariantGate ?? {
      markSessionCreated: () => {},
      clear: () => {},
    }) as never,
    managers: {} as unknown as DomainManagers,
    hooks: inertHooks(options.hooks ?? {}),
  })

  const events = [options.event]
  const pump = createEventPump({
    subscribe: async function* () {
      for (const event of events) {
        yield event as unknown as { type: string } & Record<string, unknown>
      }
    },
    handler: async (envelope) => {
      await eventHandler(envelope)
    },
    signal: new AbortController().signal,
    guard: async (_label, fn) => fn(),
    toV1Event: (event) => toV1Event(event as never),
  })

  pump.start()
  for (let attempt = 0; attempt < 200 && pump.stats().delivered === 0; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  pump.stop()
  return { delivered: pump.stats().delivered }
}

export function recordingEventHook(received: EventInput[]): { event: EventFn } {
  return {
    event: async (input) => {
      received.push(input)
    },
  }
}

export function recordingHandlerHook(received: EventInput[]): { handler: EventFn } {
  return {
    handler: async (input) => {
      received.push(input)
    },
  }
}
