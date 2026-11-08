import { log } from "../../shared/runtime/logger"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import { readSessionTasks } from "../task-session-scope/session-task-pending"
import { computeEffort } from "./calculate"
import { collectTelemetry } from "./collect"
import { attachEffortToTask } from "./persist"
import { formatEffortLine, routeReport } from "./report"
import type { EffortConfig, EffortRecord } from "./types"

export interface BackgroundEffortTask {
  id: string
  sessionID?: string
  startedAt?: Date
  completedAt?: Date
}

export interface BackgroundEffortRuntime {
  native: { session: { context(input: { sessionID: string }): Promise<unknown> } }
  directory: string
}

export interface BackgroundEffortResult {
  record: EffortRecord
  line: string
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never throws. Returns null when disabled, no session, or any failure. */
export async function recordEffortForBackground(
  rt: BackgroundEffortRuntime,
  task: BackgroundEffortTask,
  config: EffortConfig | undefined,
): Promise<BackgroundEffortResult | null> {
  try {
    if (!config?.enabled) return null
    if (!task.sessionID) return null

    const messages = await fetchSessionMessages(rt.native, task.sessionID)

    let durationMs: number | undefined
    if (task.startedAt) {
      const end = (task.completedAt ?? new Date()).getTime()
      durationMs = Math.max(0, end - task.startedAt.getTime())
    }

    const { telemetry, coverage, missing } = collectTelemetry(messages, { durationMs })
    const record = computeEffort(telemetry, config.weights, config.prices, {
      coverage,
      missing,
    })

    try {
      await attachEffortToTask(rt.directory, task.id, record)
    } catch (error) {
      log("[agent-effort] background effort primary persist failed", {
        taskId: task.id,
        reason: reasonOf(error),
      })
    }

    try {
      const sessionTasks = readSessionTasks({
        directory: rt.directory,
        sessionID: task.sessionID,
      })
      for (const sessionTask of sessionTasks) {
        if (sessionTask.threadID !== task.sessionID) continue
        await attachEffortToTask(rt.directory, sessionTask.id, record)
      }
    } catch (error) {
      log("[agent-effort] background effort session persist failed", {
        taskId: task.id,
        sessionID: task.sessionID,
        reason: reasonOf(error),
      })
    }

    const line = formatEffortLine(record)
    let parentLine: string | null = null
    try {
      routeReport(record, config, {
        parent: (value) => {
          parentLine = value
        },
      })
    } catch (error) {
      log("[agent-effort] background effort report failed", {
        taskId: task.id,
        reason: reasonOf(error),
      })
    }

    return { record, line: parentLine ?? line }
  } catch (error) {
    log("[agent-effort] background effort failed", {
      taskId: task.id,
      sessionID: task.sessionID,
      reason: reasonOf(error),
    })
    return null
  }
}
