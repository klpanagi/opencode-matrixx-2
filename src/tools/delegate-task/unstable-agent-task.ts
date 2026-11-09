import { getSubagentSessionIDs } from "../../features/session-state/state"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { formatDuration, jsonSafeMetadata } from "../../shared"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import type { SessionMessage } from "../../shared/session/session-message"
import { contentOf, isAssistant, timeOf } from "../../shared/session/session-message"
import { getSessionTools } from "../../shared/session/session-state"
import { formatDetailedError } from "./error-formatting"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { pollSyncSession } from "./sync-session-poller"
import { buildBackgroundTitle } from "./task-title"
import { getTimingConfig } from "./timing"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export async function executeUnstableAgentTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string; temperature?: number } | undefined,
  systemContent: string | undefined,
  actualModel: string | undefined
): Promise<string> {
  const { manager, client } = executorCtx

  try {
    const task = await manager.launch({
      description: args.description,
      prompt: args.prompt,
      agent: agentToUse,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      parentTools: getSessionTools(parentContext.sessionID),
      model: categoryModel,
      skills: args.load_skills.length > 0 ? args.load_skills : undefined,
      skillContent: systemContent,
      category: args.category,
    })

    const timing = getTimingConfig()
    const waitStart = Date.now()
    let sessionID = task.sessionID
    while (!sessionID && Date.now() - waitStart < timing.WAIT_FOR_SESSION_TIMEOUT_MS) {
      if (ctx.abort?.aborted) {
        return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
      }
      await new Promise(resolve => setTimeout(resolve, timing.WAIT_FOR_SESSION_INTERVAL_MS))
      const updated = manager.getTask(task.id)
      sessionID = updated?.sessionID
    }
    if (!sessionID) {
      return formatDetailedError(new Error(`Task failed to start within timeout (${timing.WAIT_FOR_SESSION_TIMEOUT_MS}ms). Task ID: ${task.id}, Status: ${task.status}`), {
        operation: "Launch monitored background task",
        args,
        agent: agentToUse,
        category: args.category,
      })
    }

    const bgTaskMeta = jsonSafeMetadata({
      title: buildBackgroundTitle(args.description, agentToUse, args.category),
      metadata: {
        prompt: args.prompt,
        agent: agentToUse,
        category: args.category,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: sessionID,
        command: args.command,
      },
    })
    await ctx.metadata?.(bgTaskMeta)
    const resolvedCallID = resolveToolCallID(ctx)
    if (resolvedCallID) {
      storeToolMetadata(ctx.sessionID, resolvedCallID, bgTaskMeta)
    }

    const monitoredSessionID = sessionID
    const resolveChildSessionIDs = executorCtx.getActiveChildSessionIDs ?? getSubagentSessionIDs
    const hasActiveChildDelegations = () => resolveChildSessionIDs(monitoredSessionID).length > 0

    const startTime = new Date()
    const timingCfg = getTimingConfig()
    const pollStart = Date.now()
    let lastMsgCount = 0
    let stablePolls = 0
    let lastPolledMsgs: SessionMessage[] | undefined
    let terminalStatus: { status: string; error?: string } | undefined

    while (Date.now() - pollStart < timingCfg.MAX_POLL_TIME_MS) {
      if (ctx.abort?.aborted) {
        return `Task aborted (was running in background mode).\n\nSession ID: ${sessionID}`
      }

      await new Promise(resolve => setTimeout(resolve, timingCfg.POLL_INTERVAL_MS))

      const currentTask = manager.getTask(task.id)
      if (currentTask && (currentTask.status === "interrupt" || currentTask.status === "error" || currentTask.status === "cancelled")) {
        terminalStatus = { status: currentTask.status, error: currentTask.error }
        break
      }

      if (Date.now() - pollStart < timingCfg.MIN_STABILITY_TIME_MS) continue

      // Never conclude success while a delegated child of this session is live:
      // reset the stability counters and keep polling instead.
      if (hasActiveChildDelegations()) {
        stablePolls = 0
        lastMsgCount = 0
        continue
      }

      const msgs = await fetchSessionMessages(client, sessionID)
      lastPolledMsgs = msgs
      const currentMsgCount = msgs.length

      if (currentMsgCount === lastMsgCount) {
        stablePolls++
        if (stablePolls >= timingCfg.STABILITY_POLLS_REQUIRED) break
      } else {
        stablePolls = 0
        lastMsgCount = currentMsgCount
      }
    }

    if (terminalStatus) {
      const duration = formatDuration(startTime)
      return `SUPERVISED TASK FAILED (${terminalStatus.status})

Task was interrupted/failed while running in monitored background mode.
${terminalStatus.error ? `Error: ${terminalStatus.error}` : ""}

Duration: ${duration}
Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}
Model: ${actualModel}

The task session may contain partial results.

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
    }

    if (hasActiveChildDelegations()) {
      const childGuardMessage = await pollSyncSession(ctx, client, {
        sessionID: monitoredSessionID,
        agentToUse,
        toastManager: null,
        taskId: task.id,
        hasActiveChildBackgroundTasks: hasActiveChildDelegations,
      })
      if (childGuardMessage) return childGuardMessage
      if (hasActiveChildDelegations()) {
        return `SUPERVISED TASK STILL RUNNING
The monitored session still has active child delegations.

Session ID: ${sessionID}
Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

Resume: session ${sessionID} is still running; poll again or resume via session ${sessionID}.

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
      }
    }

    const messages = lastPolledMsgs ?? (await fetchSessionMessages(client, sessionID))

    const assistantMessages = messages
      .filter((m) => isAssistant(m))
      .sort((a, b) => timeOf(b) - timeOf(a))
    const lastMessage = assistantMessages[0]

    if (!lastMessage) {
      return `No assistant response found (task ran in background mode).\n\nSession ID: ${sessionID}`
    }

    const textParts = contentOf(lastMessage).filter((p) => p.type === "text" || p.type === "reasoning")
    const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
    const duration = formatDuration(startTime)

    return `SUPERVISED TASK COMPLETED SUCCESSFULLY

IMPORTANT: This model (${actualModel}) is marked as unstable/experimental.
Your run_in_background=false was automatically converted to background mode for reliability monitoring.

Duration: ${duration}
Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

MONITORING INSTRUCTIONS:
- The task was monitored and completed successfully
- If you observe this agent behaving erratically in future calls, actively monitor its progress
- Use background_cancel(task_id="...") to abort if the agent seems stuck or producing garbage output
- Do NOT retry automatically if you see this message - the task already succeeded

---

RESULT:

${textContent || "(No text output)"}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Launch monitored background task",
      args,
      agent: agentToUse,
      category: args.category,
    })
  }
}
