/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { formatEffortLine, routeReport } from "../../../src/features/agent-effort/report"
import type { EffortConfig, EffortRecord, EffortReportChannel } from "../../../src/features/agent-effort/types"

function buildRecord(overrides?: Partial<EffortRecord>): EffortRecord {
  return {
    formulaVersion: 1,
    total: 3.4567,
    tokenUsd: 0.012345,
    components: {
      computeUnits: 1,
      actionUnits: 1,
      epistemicUnits: 1,
      coordUnits: 1,
      tokenUsd: 0.012345,
      total: 3.4567,
    },
    telemetry: {
      input: 100,
      output: 200,
      reasoning: 0,
      cacheRead: 300,
      cacheWrite: 400,
      steps: 5,
      toolCalls: 7,
      uniqueTools: 4,
      retries: 2,
      durationMs: 1000,
    },
    coverage: "full",
    missing: [],
    computedAt: "2026-11-08T00:00:00.000Z",
    ...overrides,
  }
}

function buildConfig(report: EffortReportChannel[], enabled = true): EffortConfig {
  return {
    enabled,
    report,
    weights: { compute: 0.5, action: 0.25, epistemic: 0.15, coord: 0.1 },
    prices: { inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003, cacheWritePer1k: 0.00375 },
    toolCosts: {},
    maxMessages: 200,
    maxBytes: 2_097_152,
    rollup: false,
  }
}

interface Recorder {
  calls: string[]
}

function recorder(): Recorder & { sink: (line: string) => void } {
  const calls: string[] = []
  return { calls, sink: (line: string) => calls.push(line) }
}

describe("formatEffortLine", () => {
  test("renders the exact expected effort line", () => {
    //#given
    const record = buildRecord()

    //#when
    const line = formatEffortLine(record)

    //#then
    expect(line).toBe("⚡ effort 3.46 ($0.0123) | in:100 out:200 cache:700 | steps:5 tools:7 retries:2 | full")
  })
})

describe("routeReport", () => {
  test("dispatches to toast only when toast is the sole channel", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["toast"]), { toast: toast.sink, log: log.sink, parent: parent.sink })

    //#then
    expect(toast.calls).toHaveLength(1)
    expect(log.calls).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
    expect(line).toBe(formatEffortLine(record))
    expect(toast.calls[0]).toBe(line)
  })

  test("dispatches to log only when log is the sole channel", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["log"]), { toast: toast.sink, log: log.sink, parent: parent.sink })

    //#then
    expect(log.calls).toHaveLength(1)
    expect(toast.calls).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
    expect(log.calls[0]).toBe(line)
  })

  test("dispatches to parent only when parent is the sole channel", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["parent"]), { toast: toast.sink, log: log.sink, parent: parent.sink })

    //#then
    expect(parent.calls).toHaveLength(1)
    expect(toast.calls).toHaveLength(0)
    expect(log.calls).toHaveLength(0)
    expect(parent.calls[0]).toBe(line)
  })

  test("invokes every configured sink once with the same line", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["toast", "log", "parent"]), {
      toast: toast.sink,
      log: log.sink,
      parent: parent.sink,
    })

    //#then
    expect(toast.calls).toEqual([line])
    expect(log.calls).toEqual([line])
    expect(parent.calls).toEqual([line])
    expect(line).toBe(formatEffortLine(record))
  })

  test("returns null and calls no sink when disabled", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["toast", "log", "parent"], false), {
      toast: toast.sink,
      log: log.sink,
      parent: parent.sink,
    })

    //#then
    expect(line).toBeNull()
    expect(toast.calls).toHaveLength(0)
    expect(log.calls).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
  })

  test("returns null and calls no sink when report contains off", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig(["off", "toast"]), { toast: toast.sink, log: log.sink, parent: parent.sink })

    //#then
    expect(line).toBeNull()
    expect(toast.calls).toHaveLength(0)
    expect(log.calls).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
  })

  test("returns null and calls no sink when report is empty", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()
    const log = recorder()
    const parent = recorder()

    //#when
    const line = routeReport(record, buildConfig([]), { toast: toast.sink, log: log.sink, parent: parent.sink })

    //#then
    expect(line).toBeNull()
    expect(toast.calls).toHaveLength(0)
    expect(log.calls).toHaveLength(0)
    expect(parent.calls).toHaveLength(0)
  })

  test("does not throw when an enabled channel has no sink", () => {
    //#given
    const record = buildRecord()
    const toast = recorder()

    //#when
    const line = routeReport(record, buildConfig(["toast", "parent", "log"]), { toast: toast.sink })

    //#then
    expect(line).toBe(formatEffortLine(record))
    expect(toast.calls).toEqual([line])
  })

  test("does not throw when no sinks are provided at all", () => {
    //#given
    const record = buildRecord()

    //#when
    const line = routeReport(record, buildConfig(["toast", "parent"]))

    //#then
    expect(line).toBe(formatEffortLine(record))
  })
})
