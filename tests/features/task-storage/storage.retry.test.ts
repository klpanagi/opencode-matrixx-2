/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const TEST_DIR_ABS = join(process.cwd(), ".test-task-storage-retry")

describe("storage B5 retry contract (single source of truth)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
    mkdirSync(TEST_DIR_ABS, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR_ABS)) rmSync(TEST_DIR_ABS, { recursive: true, force: true })
  })

  test("exports MAX_RETRIES and RETRY_DELAY_MS constants", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")

    //#when
    const max = (mod as Record<string, unknown>).MAX_RETRIES
    const base = (mod as Record<string, unknown>).RETRY_DELAY_MS

    //#then
    expect(typeof max).toBe("number")
    expect(max).toBe(4)
    expect(typeof base).toBe("number")
    expect(base).toBe(15)
  })

  test("acquireLockWithRetry uses an eight-attempt budget by default", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const { writeFileSync } = await import("node:fs")
    const { join: pjoin } = await import("node:path")
    writeFileSync(
      pjoin(TEST_DIR_ABS, ".lock"),
      JSON.stringify({ id: "holder", ownerId: "holder", pid: process.pid, timestamp: Date.now() }),
      "utf-8",
    )
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error - monkey-patch for delay capture
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0)
      return origSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      //#when
      const result = await mod.acquireLockWithRetry(TEST_DIR_ABS)

      //#then
      expect(result.acquired).toBe(false)
      expect(delays.length).toBe(7)
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  test("attempt count is exact: exhausts after MAX_RETRIES attempts", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const { MAX_RETRIES } = mod as unknown as { MAX_RETRIES: number }
    const { join: pjoin } = await import("node:path")
    const { writeFileSync } = await import("node:fs")
    writeFileSync(pjoin(TEST_DIR_ABS, ".lock"), JSON.stringify({ id: "holder", timestamp: Date.now() }), "utf-8")
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error - monkey-patch for delay capture
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0)
      return origSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      //#when
      const result = await mod.acquireLockWithRetry(TEST_DIR_ABS, MAX_RETRIES)

      //#then
      expect(result.acquired).toBe(false)
      expect(typeof result.release).toBe("function")
      expect(result.release()).toBeUndefined()
      expect(delays.length).toBe(MAX_RETRIES - 1)
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  test("default backoff doubles from a jittered 10 ms base", async () => {
    //#given
    const mod = await import("../../../src/features/task-storage/storage")
    const { writeFileSync } = await import("node:fs")
    const { join: pjoin } = await import("node:path")
    writeFileSync(
      pjoin(TEST_DIR_ABS, ".lock"),
      JSON.stringify({ id: "holder", ownerId: "holder", pid: process.pid, timestamp: Date.now() }),
      "utf-8",
    )
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-expect-error - monkey-patch for delay capture
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0)
      return origSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      //#when
      await mod.acquireLockWithRetry(TEST_DIR_ABS)

      //#then
      expect(delays.length).toBe(7)
      delays.forEach((delay, attempt) => {
        const base = 10 * 2 ** attempt
        expect(delay).toBeGreaterThanOrEqual(base)
        expect(delay).toBeLessThan(base + 10)
      })
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  test("barrel re-exports retry constants", async () => {
    //#given
    const barrel = await import("../../../src/features/task-storage/index")

    //#when
    const rec = barrel as Record<string, unknown>

    //#then
    expect(rec.MAX_RETRIES).toBe(4)
    expect(rec.RETRY_DELAY_MS).toBe(15)
  })
})
