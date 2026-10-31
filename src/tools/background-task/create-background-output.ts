import { z } from "zod"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import { resolveAny } from "../../features/background-agent/manager"
import { resolveToolCallID, storeToolMetadata } from "../../features/tool-metadata-store"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { delay } from "../../shared/delay"
import { formatDetailedError } from "../../shared/error-formatting"
import { log } from "../../shared/logger"
import { fetchSessionMessages, type SessionContextCarrier } from "../../shared/session-context-source"
import { isNativeSessionId } from "../../shared/session-id"
import { contentOf, roleOf } from "../../shared/session-message"
import { defineTool, type MatrixxToolDefinition } from "../shared/define-tool"
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

function formatForeignSessionOutput(sessionId: string, origin: "ses" | "foreign", texts: string[]): string {
  const header = [
    "# Session Output (read-only)",
    "",
    `Session ID: ${sessionId}`,
    `Origin: ${origin} (no bg_ handle \u2014 read-only, no registry write)`,
    `Messages: ${texts.length}`,
    "",
  ]
  if (texts.length === 0) {
    return [...header, "(No text output found)", "", "> Revive is bg_-only; inspect via session_read for full history."].join("\n")
  }
  return [...header, "## Messages", "", ...texts, "", "> Revive is bg_-only; inspect via session_read for full history."].join("\n")
}

export function createBackgroundOutput(manager: BackgroundManager, client: SessionContextCarrier): MatrixxToolDefinition {
  return defineTool("background_output", {
    description: BACKGROUND_OUTPUT_DESCRIPTION,
    args: {
      task_id: z.string().describe("Task ID to get output from"),
      session_id: z.string().optional().describe("Session ID alias for task_id (pass exactly one of task_id/session_id)"),
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
          session_id: args.session_id,
          block: args.block,
          timeout: args.timeout,
          full_session: args.full_session,
        })
        const ctx = toolContext as ToolContextWithMetadata
        const rawTaskId = (args.task_id ?? "").trim()
        const rawSessionId = (args.session_id ?? "").trim()
        if (rawTaskId !== "" && rawSessionId !== "" && rawTaskId !== rawSessionId) {
          return `[ERROR] ambiguous_id: task_id ("${rawTaskId}") and session_id ("${rawSessionId}") disagree. Pass exactly one identifier; never guessing.`
        }
        const id = rawTaskId !== "" ? rawTaskId : rawSessionId
        if (id === "") {
          return `Task not found: (empty id). Inspect via session_read. Revive is bg_-only.`
        }
        let resolved: Awaited<ReturnType<typeof resolveAny>>
        try {
          resolved = await resolveAny(manager, id)
        } catch {
          const task = manager.getTask(id) ?? manager.findBySession(id)
          if (!task) {
            if (isNativeSessionId(id)) {
              return `Task not found: ${id}. Native ses_ sessions without bg_ handles have no task output; inspect via session_read. Revive is bg_-only.`
            }
            return `Task not found: ${id}`
          }
          resolved = { origin: "bg", task }
        }
        if ("error" in resolved) {
          return `Task not found: ${resolved.id}. Inspect via session_read. Revive is bg_-only.`
        }
        if (resolved.origin === "ses" || resolved.origin === "foreign") {
          const sessionId = resolved.sessionId
          let texts: string[] = []
          try {
            const messages = await fetchSessionMessages(client, sessionId)
            const limit = typeof args.message_limit === "number" ? Math.min(args.message_limit, 100) : 100
            texts = messages
              .filter((m) => roleOf(m) === "assistant" || roleOf(m) === "tool" || roleOf(m) === "user")
              .slice(0, limit)
              .flatMap((m) => contentOf(m))
              .filter((p) => p.type === "text")
              .map((p) => (p as unknown as { text?: unknown }).text)
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Error fetching messages: ${message}`
          }
          return formatForeignSessionOutput(sessionId, resolved.origin, texts)
        }
        if (resolved.origin !== "bg") {
          return `Task not found: ${id}. Inspect via session_read. Revive is bg_-only.`
        }
        const task = resolved.task

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

            const currentTask = manager.getTask(task.id)
            if (!currentTask) {
              return `Task was deleted: ${task.id}`
            }

            resolvedTask = currentTask

            if (!isTaskActiveStatus(currentTask.status)) {
              break
            }

          }

          if (isTaskActiveStatus(resolvedTask.status)) {
            const finalCheck = manager.getTask(task.id)
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
