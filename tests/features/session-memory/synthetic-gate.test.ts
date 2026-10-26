import { describe, expect, test } from "bun:test"
import { isSyntheticMessage } from "../../../src/features/session-memory/constants"
import { isSyntheticCandidate } from "../../../src/features/session-memory/recall"
import { sanitizeKnownTags } from "../../../src/shared/system-directive"

describe("session-memory synthetic gate — shared-backed passthrough", () => {
  test("drops true synthetic prefixes", () => {
    expect(isSyntheticMessage("<task-notification>hi</task-notification>")).toBe(true)
    expect(isSyntheticMessage("<system-reminder>hi</system-reminder>")).toBe(true)
    expect(isSyntheticCandidate("<task-notification>hi</task-notification>")).toBe(true)
  })

  test("drops control iteration_nudge element anywhere in string", () => {
    expect(isSyntheticMessage("hello <instruction name=iteration_nudge>compress now</instruction> world")).toBe(true)
    expect(isSyntheticCandidate("hello <instruction name=iteration_nudge>compress now</instruction> world")).toBe(true)
  })

  test("unknown <foo> passes through both gates (not synthetic)", () => {
    expect(isSyntheticMessage("<foo>bar</foo>")).toBe(false)
    expect(isSyntheticCandidate("<foo>bar</foo>")).toBe(false)
  })

  test("bare (b1) prose is not synthetic", () => {
    expect(isSyntheticMessage("see build (b1) for details")).toBe(false)
    expect(isSyntheticCandidate("see build (b1) for details")).toBe(false)
  })

  test("leak scan: foo retained byte-identical via shared helper", () => {
    const foo = "<foo>bar</foo>"
    const out = sanitizeKnownTags(foo)
    expect(out).toBe(foo)
    expect(out).toContain("<foo>")
  })
})
