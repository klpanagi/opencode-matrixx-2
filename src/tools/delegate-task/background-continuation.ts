import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { jsonSafeMetadata } from "../../shared"
import { getSessionTools } from "../../shared/session/session-state"
import { formatDetailedError } from "./error-formatting"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { buildContinuationTitle } from "./task-title"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

function failContinuation(error: Error, args: DelegateTaskArgs, sessionID: string | undefined): string {
  return formatDetailedError(error, {
    operation: "Continue background task",
    args,
    sessionID,
  })
}

export async function executeBackgroundContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext
): Promise<string> {
  const { manager } = executorCtx

  const taskID = args.execute?.task_id ?? args.session_id

  if (!taskID) {
    return failContinuation(new Error("Missing background task id (bg_...)."), args, undefined)
  }

  if (taskID.startsWith("ses_")) {
    return failContinuation(
      new Error(
        `Cannot continue a background task by raw session id: ${taskID}. Pass the background task id (bg_...) from background_output instead.`
      ),
      args,
      taskID
    )
  }

  const task = manager.getTask(taskID)
  if (!task) {
    return failContinuation(
      new Error(
        `Background task not found: ${taskID}. Pass the background task id (bg_...) from background_output instead.`
      ),
      args,
      taskID
    )
  }

  if (task.parentSessionID !== parentContext.sessionID) {
    return failContinuation(
      new Error(`Task ${task.id} does not belong to parent session ${parentContext.sessionID}`),
      args,
      taskID
    )
  }

  if (!task.sessionID) {
    return failContinuation(new Error(`Task has no sessionID: ${task.id}`), args, taskID)
  }

  try {
    const resumed = await manager.resume({
      sessionId: task.sessionID,
      prompt: args.prompt,
      parentSessionID: parentContext.sessionID,
      parentMessageID: parentContext.messageID,
      parentModel: parentContext.model,
      parentAgent: parentContext.agent,
      parentTools: getSessionTools(parentContext.sessionID),
    })

    const bgContMeta = jsonSafeMetadata({
      title: buildContinuationTitle(args.description),
      metadata: {
        prompt: args.prompt,
        agent: resumed.agent,
        ...(resumed.category !== undefined ? { category: resumed.category } : {}),
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: resumed.sessionID,
        sessionId: resumed.sessionID,
        command: args.command,
      },
    })
    await ctx.metadata?.(bgContMeta)
    const resolvedCallID = resolveToolCallID(ctx)
    if (resolvedCallID) {
      storeToolMetadata(ctx.sessionID, resolvedCallID, bgContMeta)
    }

    return `Background task continued.

Task ID: ${resumed.id}
Description: ${resumed.description}
Agent: ${resumed.agent}
Status: ${resumed.status}

Agent continues with full previous context preserved.
Use \`background_output\` with task_id="${resumed.id}" to check progress.

<task_metadata>
session_id: ${resumed.sessionID}
${resumed.agent ? `subagent: ${resumed.agent}\n` : ""}</task_metadata>`
  } catch (error) {
    return failContinuation(
      error instanceof Error ? error : new Error(String(error)),
      args,
      taskID
    )
  }
}
