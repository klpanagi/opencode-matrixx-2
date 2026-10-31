import { z } from "zod"
import type { BackgroundTask } from "../../features/background-agent"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { delay } from "../../shared/delay"
import { formatDetailedError } from "../../shared/error-formatting"
import { log } from "../../shared/logger"
import type { SessionContextCarrier } from "../../shared/session-context-source"
import { isNativeSessionId } from "../../shared/session-id"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
import type { BackgroundOutputManager } from "./clients"
import { BACKGROUND_OUTPUT_DESCRIPTION } from "./constants"
import { formatFullSession } from "./full-session-format"
import { formatTaskResult } from "./task-result-format"
import { formatTaskStatus } from "./task-status-format"
import type { BackgroundOutputArgs } from "./types"

const MOUSE_AGENT = getAgentDisplayName("mouse")

type ToolContextWithMetadata = {
  sessionID: string
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  callID?: string
  callId?: string
  call_id?: string
}


function formatResolvedTitle(task: BackgroundTask): string {
  const label = task.agent === MOUSE_AGENT && task.category ? task.category : task.agent
  return `${label} - ${task.description}`
}

function isTaskActiveStatus(status: BackgroundTask["status"]): boolean {
  return status === "pending" || status === "running"
}

function appendTimeoutNote(output: string, timeoutMs: number): string {
  return `${output}\n\n> **Timed out waiting** after ${timeoutMs}ms. Task is still running; showing latest available output.`
}

export function createBackgroundOutput(manager: BackgroundOutputManager, client: SessionContextCarrier): MatrixxToolDefinition {
  return defineTool("background_output", {
    description: BACKGROUND_OUTPUT_DESCRIPTION,
    args: {
      task_id: z.string().describe("Task ID to get output from"),
      block: z
        .boolean()
        .optional()
        .describe(
          "Wait for completion (default: false). System notifies when done, so blocking is rarely needed."
        ),
      timeout: z.number().optional().describe("Max wait time in ms (default: 60000, max: 600000)"),
      full_session: z.boolean().optional().describe("Return full session messages with filters (default: false)"),
      include_thinking: z.boolean().optional().describe("Include thinking/reasoning parts in full_session output (default: false)"),
      message_limit: z.number().optional().describe("Max messages to return (capped at 100)"),
      since_message_id: z.string().optional().describe("Return messages after this message ID (exclusive)"),
      include_tool_results: z.boolean().optional().describe("Include tool results in full_session output (default: false)"),
      thinking_max_chars: z.number().optional().describe("Max characters for thinking content (default: 2000)"),
    },
    async execute(args: BackgroundOutputArgs, toolContext) {
      try {
        log("[background-task] background_output entry:", {
          task_id: args.task_id,
          block: args.block,
          timeout: args.timeout,
          full_session: args.full_session,
        })
        const ctx = toolContext as ToolContextWithMetadata
        let task = manager.getTask(args.task_id)
        if (!task) {
          // Read-only native lookup: a task_id that is actually a live
          // session ID resolves via findBySession. Ephemeral only — no
          // handles are created for native sessions here.
          const bySession = manager.findBySession?.(args.task_id)
          if (bySession) {
            log("[background-task] background_output resolved session ID to task:", {
              task_id: args.task_id,
              taskId: bySession.id,
            })
            task = bySession
          }
        }
        if (!task) {
          if (isNativeSessionId(args.task_id)) {
            return `Task not found: ${args.task_id}. Native ses_ sessions without bg_ handles have no task output; inspect via session_read. Revive is bg_-only.`
          }
          return `Task not found: ${args.task_id}`
        }

        if (!task.sessionID) {
          return formatDetailedError(
            new Error(`Task has no session ID yet. Task ID: ${task.id}, Status: ${task.status}`),
            {
              operation: "Get background task output",
              agent: task.agent,
              category: task.category,
            }
          )
        }

        const meta = {
          title: formatResolvedTitle(task),
          metadata: {
            task_id: task.id,
            agent: task.agent,
            category: task.category,
            description: task.description,
            sessionId: task.sessionID,
          } as Record<string, unknown>,
        }
        ctx.metadata?.(meta)

        const callID = resolveToolCallID(ctx)
        if (callID) {
          storeToolMetadata(ctx.sessionID, callID, meta)
        }

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)
        const fullSession = args.full_session ?? isTaskActiveStatus(task.status)

        let resolvedTask = task

        let didTimeoutWhileActive = false

        if (shouldBlock && isTaskActiveStatus(task.status)) {
          const startTime = Date.now()
          while (Date.now() - startTime < timeoutMs) {
            await delay(1000)

            const currentTask = manager.getTask(args.task_id)
            if (!currentTask) {
              return `Task was deleted: ${args.task_id}`
            }

            resolvedTask = currentTask

            if (!isTaskActiveStatus(currentTask.status)) {
              break
            }

          }

          if (isTaskActiveStatus(resolvedTask.status)) {
            const finalCheck = manager.getTask(args.task_id)
            if (finalCheck) {
              resolvedTask = finalCheck
            }
          }

          if (isTaskActiveStatus(resolvedTask.status)) {
            didTimeoutWhileActive = true
          }
        }

        const isActive = isTaskActiveStatus(resolvedTask.status)
        const includeThinking = isActive || (args.include_thinking ?? false)
        const includeToolResults = isActive || (args.include_tool_results ?? false)

        if (fullSession) {
          const output = await formatFullSession(resolvedTask, client, {
            includeThinking,
            messageLimit: args.message_limit,
            sinceMessageId: args.since_message_id,
            includeToolResults,
            thinkingMaxChars: args.thinking_max_chars,
          })

          return didTimeoutWhileActive ? appendTimeoutNote(output, timeoutMs) : output
        }

        if (resolvedTask.status === "completed") {
          return await formatTaskResult(resolvedTask, client)
        }

        if (
          resolvedTask.status === "error" ||
          resolvedTask.status === "cancelled" ||
          resolvedTask.status === "interrupt" ||
          resolvedTask.status === "stopped" ||
          resolvedTask.status === "statusUncertain"
        ) {
          return formatTaskStatus(resolvedTask)
        }

        const statusOutput = formatTaskStatus(resolvedTask)
        return didTimeoutWhileActive ? appendTimeoutNote(statusOutput, timeoutMs) : statusOutput
      } catch (error) {
        return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
