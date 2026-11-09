import { findNearestMessageWithFields } from "../../features/context-injection/hook-bridge"
import { lookupSubagentParent } from "../../features/session-state/parent-registry"
import { getActiveTaskToastManager } from "../../features/task-toast-manager/manager"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDuration, getMessageDir, jsonSafeMetadata } from "../../shared"
import { promptNativeWithModelSuggestionRetry } from "../../shared/model/model-suggestion-retry"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import { setSessionTools } from "../../shared/session/session-state"
import { getAgentToolRestrictions } from "../../shared/tool/agent-tool-restrictions"
import { getDeliverableTag, isPlanFamily } from "./constants"
import type { ExecutorContext } from "./executor-types"
import { type SyncContinuationDeps, syncContinuationDeps } from "./sync-continuation-deps"
import { buildContinuationTitle } from "./task-title"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  deps: SyncContinuationDeps = syncContinuationDeps
): Promise<string> {
  const { client } = executorCtx
  const toastManager = getActiveTaskToastManager()
  const continuationID = args.execute?.task_id ?? args.session_id

  if (!continuationID?.startsWith("ses_")) {
    return `Failed to continue session ${continuationID ?? "(none)"}: expected a ses_ session id.`
  }

  const registeredParent = (deps.getParentSessionID ?? lookupSubagentParent)(continuationID)
  if (registeredParent !== undefined && registeredParent !== ctx.sessionID) {
    return `Failed to continue session ${continuationID}: not owned by the calling session.`
  }

  const taskId = `resume_sync_${continuationID?.slice(0, 8)}`
  const startTime = new Date()

  if (toastManager) {
    toastManager.addTask({
      id: taskId,
      description: args.description,
      agent: "continue",
      isBackground: false,
    })
  }

  let resumeAgent: string | undefined
  let anchorMessageCount: number | undefined

  try {
    try {
      const messages = await fetchSessionMessages(client, continuationID as string)
      anchorMessageCount = messages.length
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.agent || message.model) {
          resumeAgent = message.agent
          break
        }
      }
    } catch {
      const resumeMessageDir = getMessageDir(continuationID as string)
      const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
      resumeAgent = resumeMessage?.agent
    }

    const syncContMeta = jsonSafeMetadata({
      title: buildContinuationTitle(args.description),
      metadata: {
        prompt: args.prompt,
        ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
        ...(args.category !== undefined ? { category: args.category } : {}),
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: continuationID,
        sessionId: continuationID,
        sync: true,
        command: args.command,
      },
    })
    await ctx.metadata?.(syncContMeta)
    const resolvedCallID = resolveToolCallID(ctx)
    if (resolvedCallID) {
      storeToolMetadata(ctx.sessionID, resolvedCallID, syncContMeta)
    }

    const allowTask = isPlanFamily(resumeAgent)
    const tools = {
      ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
      task: allowTask,
      question: false,
    }
    setSessionTools(continuationID as string, tools)

    // Native v2 session.prompt takes { sessionID, text } only. The resumed
    // session keeps the agent/model pinned at its creation; tools stay in the
    // local session-state store set above.
    await promptNativeWithModelSuggestionRetry(client.session, {
      sessionID: continuationID as string,
      text: args.prompt,
    })
  } catch (promptError) {
    if (toastManager) {
      toastManager.removeTask(taskId)
    }
    const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
    return `Failed to send continuation prompt: ${errorMessage}\n\nSession ID: ${continuationID}`
  }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID: continuationID as string,
        agentToUse: resumeAgent ?? "continue",
        toastManager,
        taskId,
        anchorMessageCount,
      })
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, continuationID as string, anchorMessageCount, {
        deliverableTag: getDeliverableTag(resumeAgent),
        finalTextOnly: true,
      })
      if (!result.ok) {
        return result.error
      }

     const duration = formatDuration(startTime)

     const textContent = result.textContent.trim()
     if (textContent.length === 0) {
       return `Task returned no readable output (empty assistant text).

Resume the same session instead of spawning a new one:
  task(session_id="${continuationID}", prompt="...")

Session ID: ${continuationID}`
     }
     return `Task continued and completed in ${duration}.

---

${textContent}

<task_metadata>
session_id: ${continuationID}
${resumeAgent ? `subagent: ${resumeAgent}\n` : ""}</task_metadata>`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}
