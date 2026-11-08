import { log as writeLog } from "../../shared/runtime/logger"

import type { EffortConfig, EffortRecord, EffortReportChannel } from "./types"

export interface EffortReportSinks {
  toast?: (line: string) => void
  log?: (line: string) => void
  parent?: (line: string) => void
}

export function formatEffortLine(record: EffortRecord): string {
  const { telemetry } = record
  const cache = telemetry.cacheRead + telemetry.cacheWrite
  return (
    `⚡ effort ${record.total.toFixed(2)} ($${record.tokenUsd.toFixed(4)})` +
    ` | in:${telemetry.input} out:${telemetry.output} cache:${cache}` +
    ` | steps:${telemetry.steps} tools:${telemetry.toolCalls} retries:${telemetry.retries}` +
    ` | ${record.coverage}`
  )
}

function isReportable(config: EffortConfig): boolean {
  if (!config.enabled) return false
  if (config.report.length === 0) return false
  return !config.report.includes("off")
}

function dispatch(channel: EffortReportChannel, line: string, sinks: EffortReportSinks): void {
  if (channel === "toast") {
    sinks.toast?.(line)
    return
  }
  if (channel === "log") {
    ;(sinks.log ?? writeLog)(line)
    return
  }
  if (channel === "parent") {
    sinks.parent?.(line)
  }
}

export function routeReport(
  record: EffortRecord,
  config: EffortConfig,
  sinks: EffortReportSinks = {},
): string | null {
  if (!isReportable(config)) return null

  const line = formatEffortLine(record)
  for (const channel of config.report) {
    dispatch(channel, line, sinks)
  }
  return line
}
