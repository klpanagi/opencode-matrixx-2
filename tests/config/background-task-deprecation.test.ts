/// <reference types="bun-types" />

/**
 * Guardrail for D5: no `background_task` config key is removed, and every
 * inert key carries a `deprecated` marker plus exactly one process warning.
 *
 * RED by design on the parent commit: none of the inert keys have a
 * `deprecated` marker and `warnDeprecatedBackgroundTaskKeys` does not exist.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  BackgroundTaskConfigSchema,
  JobBoardConfigSchema,
  WakeSchedulerConfigSchema,
} from "../../src/config/schema/background-task"
import {
  INERT_BACKGROUND_TASK_KEYS,
  _resetDeprecationWarningForTesting,
  warnDeprecatedBackgroundTaskKeys,
} from "../../src/config/schema/background-task-deprecation"

const SRC = path.join(import.meta.dir, "../../src")

function readSchemaSource(): string {
  return fs.readFileSync(path.join(SRC, "config/schema/background-task.ts"), "utf-8")
}

describe("inert key deprecated markers (D5)", () => {
  test("every inert top-level key description carries `deprecated`", () => {
    //#given the parsed BackgroundTaskConfigSchema shape
    const shape = BackgroundTaskConfigSchema.shape

    //#when reading each inert key's description
    const descriptions = INERT_BACKGROUND_TASK_KEYS.map(
      (key) => ({ key, description: shape[key].description ?? "" }),
    )

    //#then every inert key is marked deprecated exactly once
    for (const { key, description } of descriptions) {
      expect(description.toLowerCase()).toContain("deprecated")
      expect((description.match(/deprecated/gi) ?? []).length).toBe(1)
      expect(key).toBeTruthy()
    }
  })

  test("every WakeSchedulerConfigSchema key description carries `deprecated`", () => {
    //#given the exported wake-scheduler schema
    const shape = WakeSchedulerConfigSchema.shape

    //#when / #then both nested keys are marked
    for (const key of ["enabled", "intervalMs"] as const) {
      expect((shape[key].description ?? "").toLowerCase()).toContain("deprecated")
    }
  })

  test("every JobBoardConfigSchema key description carries `deprecated`", () => {
    //#given the exported job-board schema
    const shape = JobBoardConfigSchema.shape

    //#when / #then every nested key is marked
    for (const key of ["enabled", "strategy", "maxRetainedSnapshots"] as const) {
      expect((shape[key].description ?? "").toLowerCase()).toContain("deprecated")
    }
  })

  test("nested circuit-breaker keys carry `deprecated` markers in source", () => {
    //#given the private CircuitBreakerConfigSchema block in source text
    const source = readSchemaSource()
    const start = source.indexOf("const CircuitBreakerConfigSchema")
    const end = source.indexOf("export const WakeSchedulerConfigSchema")
    const block = source.slice(start, end)

    //#when / #then all three inert nested keys are marked
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect((block.match(/deprecated/gi) ?? []).length).toBe(3)
  })

  test("live keys are not marked inert", () => {
    //#given the inert key list
    const inert = new Set<string>(INERT_BACKGROUND_TASK_KEYS)

    //#when / #then functional keys stay live
    expect(inert.has("handleTtlMs")).toBe(false)
    expect(inert.has("wallClockTimeoutMs")).toBe(false)
    expect(inert.has("dedupeActiveDelegations")).toBe(false)
  })
})

describe("deprecated keys remain parseable (D5 — no removal)", () => {
  test("schema accepts every deprecated key and preserves the values", () => {
    //#given a config that sets every inert key
    const config = {
      defaultConcurrency: 2,
      providerConcurrency: { anthropic: 1 },
      modelConcurrency: { "claude-sonnet-4": 2 },
      staleTimeoutMs: 60000,
      messageStalenessTimeoutMs: 60000,
      maxToolCalls: 10,
      circuitBreaker: { enabled: true, maxToolCalls: 10, consecutiveThreshold: 5 },
      wakeScheduler: { enabled: false, intervalMs: 60000 },
      jobBoard: { enabled: true, strategy: "checkpoint-compatible" as const, maxRetainedSnapshots: 5 },
      wallClockAbortGraceMs: 1000,
    }

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then nothing is stripped and every value round-trips
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject(config)
    }
  })
})

describe("warnDeprecatedBackgroundTaskKeys", () => {
  let warnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetDeprecationWarningForTesting()
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    _resetDeprecationWarningForTesting()
  })

  test("warns exactly once across two calls with deprecated keys", () => {
    //#given a config carrying inert keys
    const config = { wakeScheduler: { enabled: true } }

    //#when the loader calls the warning twice in one process
    warnDeprecatedBackgroundTaskKeys(config)
    warnDeprecatedBackgroundTaskKeys(config)

    //#then only one warning is emitted and it names the inert key
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("wakeScheduler")
  })

  test("stays silent when only live keys are present", () => {
    //#given a config with functional keys only
    const config = {
      handleTtlMs: 60000,
      wallClockTimeoutMs: 0,
      dedupeActiveDelegations: true,
    }

    //#when
    warnDeprecatedBackgroundTaskKeys(config)

    //#then no warning is emitted
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test("stays silent when no background_task config is present", () => {
    //#given no parsed background-task config
    //#when
    warnDeprecatedBackgroundTaskKeys(undefined)

    //#then no warning is emitted
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test("reset hook re-arms the one-time warning", () => {
    //#given a deprecated key already warned about once
    warnDeprecatedBackgroundTaskKeys({ jobBoard: { enabled: true } })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    //#when the test hook resets module state and the loader warns again
    _resetDeprecationWarningForTesting()
    warnDeprecatedBackgroundTaskKeys({ jobBoard: { enabled: true } })

    //#then the warning fires once more
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})
