/**
 * Consumers of the plugin event path, one fixture per entry. Two kinds exist:
 * hooks called from dispatchToHooks, and state createEventHandler mutates
 * inline (NON_DISPATCH_CONSUMERS) without delegating to a hook.
 */
export const EVENT_CONSUMERS = [
  "agent-usage-reminder",
  "auto-update-checker",
  "background-notification",
  "category-skill-reminder",
  "context-window-limit-recovery",
  "context-window-monitor",
  "directory-agents-injector",
  "first-message-variant-gate",
  "interactive-bash-session",
  "knowledge-hub-injector",
  "matrix-loop",
  "niobe-hook",
  "nudge-loop-breaker",
  "plan-persister",
  "rules-injector",
  "runtime-fallback",
  "session-memory",
  "session-notification",
  "session-recovery",
  "session-state",
  "session-status-normalizer",
  "stop-continuation-guard",
  "task-continuation-enforcer",
  "think-mode",
  "unstable-agent-babysitter",
] as const

export type EventConsumer = (typeof EVENT_CONSUMERS)[number]

export const HOOK_CONSUMER_MAP: Record<string, EventConsumer> = {
  agentUsageReminder: "agent-usage-reminder",
  autoUpdateChecker: "auto-update-checker",
  backgroundNotificationHook: "background-notification",
  categorySkillReminder: "category-skill-reminder",
  contextWindowLimitRecovery: "context-window-limit-recovery",
  contextWindowMonitor: "context-window-monitor",
  directoryAgentsInjector: "directory-agents-injector",
  interactiveBashSession: "interactive-bash-session",
  knowledgeHubInjector: "knowledge-hub-injector",
  matrixLoop: "matrix-loop",
  niobeHook: "niobe-hook",
  nudgeLoopBreaker: "nudge-loop-breaker",
  planPersister: "plan-persister",
  rulesInjector: "rules-injector",
  runtimeFallback: "runtime-fallback",
  sessionMemory: "session-memory",
  sessionNotification: "session-notification",
  sessionRecovery: "session-recovery",
  stopContinuationGuard: "stop-continuation-guard",
  taskContinuationEnforcer: "task-continuation-enforcer",
  thinkMode: "think-mode",
  unstableAgentBabysitter: "unstable-agent-babysitter",
}

export const NON_DISPATCH_CONSUMERS: EventConsumer[] = [
  "first-message-variant-gate",
  "session-state",
  "session-status-normalizer",
]

export function fixtureFileFor(consumer: string): string {
  return consumer + ".test.ts"
}
