import { registerSubagentSession, unregisterSubagentSession } from "../../features/session-state/state"
import { getTaskToastManager } from "../../features/task-toast-manager"
import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDuration, jsonSafeMetadata } from "../../shared"
import { log } from "../../shared/logger"
import { isPollTimeoutOutcome } from "../../shared/poll-timeout-outcome"
import { getDeliverableTag } from "./constants"
import { formatDetailedError } from "./error-formatting"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { formatEmptySessionError, getEmptyRetryBackoffMs, isSessionEmpty } from "./sync-empty-retry"
import { type SyncTaskDeps, syncTaskDeps } from "./sync-task-deps"
import { getTimingConfig } from "./timing"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

async function withHardTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function executeSyncTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string; temperature?: number } | undefined,
  systemContent: string | undefined,
  modelInfo?: ModelFallbackInfo,
  deps: SyncTaskDeps = syncTaskDeps
): Promise<string> {
  const { client, directory, onSyncSessionCreated } = executorCtx
  const toastManager = getTaskToastManager()
  let taskId: string | undefined
  let syncSessionID: string | undefined
  let pollTimedOut = false
  let didSucceed = false

  try {
    const createSessionResult = await deps.createSyncSession(client, {
      parentSessionID: parentContext.sessionID,
      agentToUse,
      description: args.description,
      defaultDirectory: directory,
      ...(categoryModel !== undefined
        ? {
            model: {
              providerID: categoryModel.providerID,
              modelID: categoryModel.modelID,
              ...(categoryModel.variant !== undefined ? { variant: categoryModel.variant } : {}),
            },
          }
        : {}),
    })

    if (!createSessionResult.ok) {
      return createSessionResult.error
    }

    const sessionID = createSessionResult.sessionID
    syncSessionID = sessionID
    registerSubagentSession(sessionID, parentContext.sessionID)

    if (onSyncSessionCreated) {
      log("[task] Invoking onSyncSessionCreated callback", { sessionID, parentID: parentContext.sessionID })
      await onSyncSessionCreated({
        sessionID,
        parentID: parentContext.sessionID,
        title: args.description,
      }).catch((err) => {
      log("[task] onSyncSessionCreated callback failed", { error: String(err) })
      })
      await new Promise(r => setTimeout(r, 200))
    }

    taskId = `sync_${sessionID.slice(0, 8)}`
    const startTime = new Date()

    if (toastManager) {
      toastManager.addTask({
        id: taskId,
        description: args.description,
        agent: agentToUse,
        isBackground: false,
        category: args.category,
        skills: args.load_skills,
        modelInfo,
      })
    }

    const syncTaskMeta = jsonSafeMetadata({
      title: args.description,
      metadata: {
        prompt: args.prompt,
        agent: agentToUse,
        category: args.category,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: sessionID,
        sync: true,
        command: args.command,
      },
    })
    await ctx.metadata?.(syncTaskMeta)
    const resolvedCallID = resolveToolCallID(ctx)
    if (resolvedCallID) {
      storeToolMetadata(ctx.sessionID, resolvedCallID, syncTaskMeta)
    }

    // Outer hard timeout: a hung send/poll SDK await never settles, and the
    // poll loop's own budget only bounds its iterations — not a stuck await.
    // Derived from MAX_POLL_TIME_MS with one poll interval of grace so a
    // healthy in-flight poll wins the race and keeps its structured outcome.
    const syncTiming = getTimingConfig()
    const hardTimeoutMs = Math.max(syncTiming.MAX_POLL_TIME_MS, 50) + syncTiming.POLL_INTERVAL_MS
    let hardTimedOut = false
    const hardTimeoutError = (): string =>
      formatDetailedError(
        new Error(
          `Sync task timed out: send+poll pipeline did not settle within ${hardTimeoutMs}ms for session ${sessionID}`
        ),
        {
          operation: "Send+poll sync task",
          args,
          sessionID,
          agent: agentToUse,
          category: args.category,
        }
      )

    try {
      // One send+poll attempt under the hard timeout. The retry-once policy
      // below reuses this verbatim — same timeout semantics per attempt.
      const runSendPoll = (): Promise<string | null> =>
        withHardTimeout(
          (async (): Promise<string | null> => {
            const sendError = await deps.sendSyncPrompt(client, {
              sessionID,
              agentToUse,
              args,
              systemContent,
              categoryModel,
              toastManager,
              taskId,
            })
            if (sendError) return sendError
            return deps.pollSyncSession(ctx, client, {
              sessionID,
              agentToUse,
              toastManager,
              taskId,
              hasActiveChildBackgroundTasks: () => {
                const children = executorCtx.manager.getTasksByParentSession(sessionID)
                return children.some(t => t.status === "running" || t.status === "pending")
              },
            })
          })(),
          hardTimeoutMs,
          () => {
            hardTimedOut = true
            return hardTimeoutError()
          }
        )

      const classifyPromptError = (promptError: string): string => {
        if (hardTimedOut) {
          // Watchdog fired: the subagent session is likely still running —
          // keep it alive (no abort) so the caller can resume via session_id.
          pollTimedOut = true
        } else {
          pollTimedOut = isPollTimeoutOutcome(promptError)
        }
        return promptError
      }

      let promptError = await runSendPoll()

      // Retry-once-on-empty: the pipeline reported success (null promptError)
      // but the session has ZERO messages — the model silently produced
      // nothing. Retry the prompt exactly once after a short backoff; if the
      // retry is also empty, surface a structured error (never null/empty).
      if (!promptError && (await isSessionEmpty(client, sessionID))) {
        log("[task] Empty sync response - retrying prompt once", { sessionID })
        await new Promise((resolve) => setTimeout(resolve, getEmptyRetryBackoffMs()))
        hardTimedOut = false
        promptError = await runSendPoll()
        if (!promptError && (await isSessionEmpty(client, sessionID))) {
          log("[task] Empty sync response after retry - surfacing structured error", { sessionID })
          return formatEmptySessionError(args, sessionID, agentToUse)
        }
      }

      if (promptError) {
        return classifyPromptError(promptError)
      }

      const result = await deps.fetchSyncResult(client, sessionID, undefined, {
        deliverableTag: getDeliverableTag(agentToUse),
        finalTextOnly: true,
      })
      if (!result.ok) {
        return result.error
      }

      didSucceed = true
      const duration = formatDuration(startTime)

      return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
    } finally {
      if (toastManager && taskId !== undefined) {
        toastManager.removeTask(taskId)
      }
    }
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Execute task",
      args,
      sessionID: syncSessionID,
      agent: agentToUse,
      category: args.category,
    })
  } finally {
    if (syncSessionID) {
      unregisterSubagentSession(syncSessionID)
      // Abort the sync session to prevent todo-continuation enforcer
      // from re-awakening a completed sync agent's session.
      // Only interrupt on failure/abandon: success sessions idle-out silently
      // to avoid alarming session.execution.interrupted after every subagent.
      // On poll timeout the session is still running — keep it alive so the
      // caller can resume via session_id.
      if (!pollTimedOut && !didSucceed) {
        client.session.interrupt({ sessionID: syncSessionID }).catch((err) => { log("[delegate-task] Sync session interrupt failed:", err) })
      }
    }
  }
}
