import type { HookName, MatrixxConfig } from "../../config"
import { resolveMemoryBackend } from "../../config/schema/memory"
import type { BackgroundManager } from "../../features/background-agent"
import {
  createBackgroundNotificationHook,
  createCompactionContextInjector,
  createNiobeHook,
  createNudgeLoopBreakerHook,
  createPlanPersister,
  createStopContinuationGuardHook,
} from "../../hooks"
import { bindSafeHook } from "../../shared/agent/safe-create-hook"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { stateRootFromPluginContext } from "../../shared/session/state-root"

export type ContinuationHooks = {
  stopContinuationGuard: ReturnType<typeof createStopContinuationGuardHook> | null
  compactionContextInjector: ReturnType<typeof createCompactionContextInjector> | null
  nudgeLoopBreaker: ReturnType<typeof createNudgeLoopBreakerHook> | null
  backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null
  niobeHook: ReturnType<typeof createNiobeHook> | null
  planPersister: ReturnType<typeof createPlanPersister> | null
}

type SessionRecovery = {
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
} | null

export function createContinuationHooks(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  backgroundManager: BackgroundManager
  sessionRecovery: SessionRecovery
}): ContinuationHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled, backgroundManager } = args
  void args.sessionRecovery

  const safeHook = bindSafeHook(safeHookEnabled)

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? safeHook("stop-continuation-guard", () =>
        createStopContinuationGuardHook(ctx, { backgroundManager }))
    : null

  const compactionMemoryEnabled =
    resolveMemoryBackend(pluginConfig.memory) === "native" &&
    (pluginConfig.memory?.native?.enabled === true || pluginConfig.memory?.enabled === true)
  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? safeHook("compaction-context-injector", () =>
        createCompactionContextInjector(backgroundManager, { enabled: compactionMemoryEnabled }))
    : null

  const nudgeLoopBreaker = isHookEnabled("nudge-loop-breaker")
    ? safeHook("nudge-loop-breaker", () => createNudgeLoopBreakerHook(ctx))
    : null

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? safeHook("background-notification", () => createBackgroundNotificationHook(backgroundManager))
    : null

  const niobeHook = isHookEnabled("niobe")
    ? safeHook("niobe", () =>
        createNiobeHook(ctx, {
          directory: stateRootFromPluginContext(ctx),
          backgroundManager,
          isContinuationStopped: (sessionID: string) =>
            stopContinuationGuard?.isStopped(sessionID) ?? false,
          agentOverrides: pluginConfig.agents,
        }))
    : null

  const planPersister = isHookEnabled("plan-persister")
    ? safeHook("plan-persister", () =>
        createPlanPersister(ctx, { directory: stateRootFromPluginContext(ctx) }))
    : null

  return {
    stopContinuationGuard,
    compactionContextInjector,
    nudgeLoopBreaker,
    backgroundNotificationHook,
    niobeHook,
    planPersister,
  }
}
