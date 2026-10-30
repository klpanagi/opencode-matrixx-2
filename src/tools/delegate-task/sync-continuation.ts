import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDuration, getMessageDir, jsonSafeMetadata } from "../../shared"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { fetchSessionMessages } from "../../shared/session-context-source"
import { setSessionTools } from "../../shared/session-state"
import { getDeliverableTag, isPlanFamily } from "./constants"
import type { ExecutorContext } from "./executor-types"
import { type SyncContinuationDeps, syncContinuationDeps } from "./sync-continuation-deps"
import { promptEnvelopeErrorOf, type SyncPromptV2Args, toPromptRetryClient } from "./sync-prompt-sender"
import { buildContinuationTitle } from "./task-title"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  deps: SyncContinuationDeps = syncContinuationDeps
): Promise<string> {
  const { client } = executorCtx
  const toastManager = getTaskToastManager()
  const continuationID = args.execute?.task_id ?? args.session_id
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
  let resumeModel: { providerID: string; modelID: string } | undefined
  let resumeVariant: string | undefined
  let anchorMessageCount: number | undefined

  try {
    try {
      const messages = await fetchSessionMessages(client, continuationID as string)
      anchorMessageCount = messages.length
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.agent || message.model) {
          resumeAgent = message.agent
          resumeModel = message.model
            ? { providerID: message.model.providerID, modelID: message.model.modelID }
            : undefined
          resumeVariant = message.model?.variant
          break
        }
      }
    } catch {
      const resumeMessageDir = getMessageDir(continuationID as string)
      const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
      resumeAgent = resumeMessage?.agent
      resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
        ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
        : undefined
      resumeVariant = resumeMessage?.model?.variant
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
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, syncContMeta)
    }

    const allowTask = isPlanFamily(resumeAgent)
    const tools = {
      ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
      task: allowTask,
      question: false,
    }
    setSessionTools(continuationID as string, tools)

    const continuationPromptArgs: SyncPromptV2Args = {
      sessionID: continuationID as string,
      ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
      ...(resumeModel !== undefined ? { model: resumeModel } : {}),
      ...(resumeVariant !== undefined ? { variant: resumeVariant } : {}),
      tools,
      parts: [{ type: "text", text: args.prompt }],
    }
    const settled: unknown = await promptWithModelSuggestionRetry(
      toPromptRetryClient(client),
      continuationPromptArgs as unknown as Parameters<typeof promptWithModelSuggestionRetry>[1]
    )
    const envelopeError = promptEnvelopeErrorOf(settled)
    if (envelopeError !== null) {
      if (toastManager) {
        toastManager.removeTask(taskId)
      }
      const statusSuffix = envelopeError.status !== undefined ? ` (status ${envelopeError.status})` : ""
      return `Failed to send continuation prompt: ${envelopeError.message}${statusSuffix}\n\nSession ID: ${continuationID}`
    }
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

     return `Task continued and completed in ${duration}.

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${continuationID}
${resumeAgent ? `subagent: ${resumeAgent}\n` : ""}</task_metadata>`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}
