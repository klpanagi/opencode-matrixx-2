import { describe, expect, test } from "bun:test"
import { BackgroundTaskConfigSchema } from "../../src/config/schema/background-task"

describe("BackgroundTaskConfigSchema removed admission fields (PR-2)", () => {
  test("deleted admissionTimeoutMs/nestedAdmission keys are stripped, absents parse cleanly", () => {
    //#given a config carrying the removed keys (e.g. from an older build)
    const config = { admissionTimeoutMs: 0, nestedAdmission: { enabled: true } }

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then unknown keys are stripped (zod default), parse succeeds with no such data
    expect(result.success).toBe(true)
    if (result.success) {
      expect("admissionTimeoutMs" in result.data).toBe(false)
      expect("nestedAdmission" in result.data).toBe(false)
    }
  })
})

describe("BackgroundTaskConfigSchema handleTtlMs", () => {
  test("accepts handleTtlMs: 60000 (minimum value)", () => {
    //#given
    const config = { handleTtlMs: 60000 }

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.handleTtlMs).toBe(60000)
    }
  })

  test("rejects handleTtlMs below minimum", () => {
    //#given
    const config = { handleTtlMs: 30000 }

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects non-integer handleTtlMs", () => {
    //#given
    const config = { handleTtlMs: 60000.5 }

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("omitted handleTtlMs parses to undefined", () => {
    //#given
    const config = {}

    //#when
    const result = BackgroundTaskConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.handleTtlMs).toBeUndefined()
    }
  })
})
