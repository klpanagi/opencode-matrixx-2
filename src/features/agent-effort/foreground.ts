import { log } from "../../shared/runtime/logger"
import { fetchSessionMessages } from "../../shared/session/session-context-source"
import { getParentSessionID } from "../session-state/state"
import { computeEffort } from "./calculate"
import { type CollectTiming, collectTelemetry } from "./collect"
import { attachEffortToTask } from "./persist"
import { formatEffortLine, routeReport } from "./report"
import { resolveEffortTaskId } from "./resolve-task"
import type { EffortConfig, EffortRecord } from "./types"

export interface ForegroundEffortInput {
  client: { session: { context(input: { sessionID: string }): Promise<unknown> } }
  directory: string
  sessionID: string
  config: EffortConfig | undefined
  startedAt?: Date
  completedAt?: Date
  parentID?: string
  parentSessionID?: string
}

export interface ForegroundEffortResult {
  record: EffortRecord
  line: string
}

function timingFor(input: ForegroundEffortInput): CollectTiming | undefined {
  if (input.startedAt === undefined) return undefined
  const completedAt = input.completedAt ?? new Date()
  const durationMs = completedAt.getTime() - input.startedAt.getTime()
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined
  return { durationMs }
}

/** Never throws. Returns null when disabled or on any failure. */
export async function recordEffortForForeground(
  input: ForegroundEffortInput,
): Promise<ForegroundEffortResult | null> {
  const { config } = input
  if (!config?.enabled) return null

  try {
    const messages = await fetchSessionMessages(input.client, input.sessionID)
    const collected = collectTelemetry(messages, timingFor(input))
    const record = computeEffort(collected.telemetry, config.weights, config.prices, {
      coverage: collected.coverage,
      missing: collected.missing,
    })

    const taskId = resolveEffortTaskId({
      directory: input.directory,
      explicitTaskId: input.parentID,
      sessionID: input.sessionID,
      parentSessionID: input.parentSessionID,
      getParentSessionID,
    })
    if (taskId !== undefined) {
      await attachEffortToTask(input.directory, taskId, record)
    }

    const line = formatEffortLine(record)
    let parentLine: string | null = null
    routeReport(record, config, {
      parent: (reported) => {
        parentLine = reported
      },
    })

    return { record, line: parentLine ?? line }
  } catch (error) {
    log("[agent-effort] foreground effort computation failed", {
      sessionID: input.sessionID,
      reason: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
