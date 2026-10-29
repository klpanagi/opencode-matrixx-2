import { describe, expect, it } from "bun:test"
import { consumeToolMetadata, storeToolMetadata } from "../../../src/features/tool-metadata-store"
import { jsonSafeMetadata } from "../../../src/shared/json-safe-metadata"

describe("jsonSafeMetadata", () => {
  it("keeps a payload with command undefined JSON-serializable", () => {
    //#given
    const payload = { title: "do things", metadata: { prompt: "hi", command: undefined } }

    //#when
    const safe = jsonSafeMetadata(payload)
    const text = JSON.stringify(safe)

    //#then
    expect(() => JSON.parse(text)).not.toThrow()
    expect(text).not.toContain("command")
  })

  it("drops undefined, function, and symbol values", () => {
    //#given
    const fn = () => "x"
    const sym = Symbol("s")
    const payload = { a: undefined, b: fn, c: sym, keep: "yes", nested: { d: undefined, e: fn } }

    //#when
    const safe = jsonSafeMetadata(payload) as Record<string, unknown>

    //#then
    expect(safe).toEqual({ keep: "yes", nested: {} })
  })

  it("does not throw on cyclic objects and marks the cycle", () => {
    //#given
    const loop: Record<string, unknown> = { name: "loop" }
    loop.self = loop

    //#when
    const safe = jsonSafeMetadata({ metadata: loop }) as { metadata: Record<string, unknown> }

    //#then
    expect(safe.metadata.self).toBe("[circular]")
    expect(() => JSON.stringify(safe)).not.toThrow()
  })

  it("converts Date to ISO string and bigint via String", () => {
    //#given
    const payload = { when: new Date("2026-01-02T03:04:05.000Z"), big: 42n }

    //#when
    const safe = jsonSafeMetadata(payload) as Record<string, unknown>

    //#then
    expect(safe.when).toBe("2026-01-02T03:04:05.000Z")
    expect(safe.big).toBe("42")
    expect(jsonSafeMetadata({ n: null })).toEqual({ n: null })
  })

  it("hands the sanitized payload to storeToolMetadata", () => {
    //#given
    const payload = { title: "t", metadata: { prompt: "p", command: undefined } }

    //#when
    storeToolMetadata("ses-test", "call-test", jsonSafeMetadata(payload))
    const stored = consumeToolMetadata("ses-test", "call-test")

    //#then
    expect(stored).toBeDefined()
    expect(() => JSON.stringify(stored)).not.toThrow()
    expect(stored?.metadata).toEqual({ prompt: "p" })
  })

  it("drops unsafe elements from arrays without throwing", () => {
    //#given
    const payload = { items: [1, undefined, () => 2, "ok"] }

    //#when
    const safe = jsonSafeMetadata(payload) as Record<string, unknown>

    //#then
    expect(safe.items).toEqual([1, "ok"])
    expect(() => JSON.stringify(safe)).not.toThrow()
  })
})
