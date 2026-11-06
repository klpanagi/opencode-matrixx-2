/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import {
  _resetContextModeEnforcementForTesting,
  _setCtxToolsForTesting,
} from "../../../../src/shared/policy/context-mode-enforcement"
import {
  buildContextModeRoutingBlock,
  buildFallbackRoutingBlock,
} from "../../../../src/features/context-injection/routing"

describe("routing block bounded-Read sentence", () => {
  afterEach(() => {
    _resetContextModeEnforcementForTesting()
    _setCtxToolsForTesting(null)
  })

  test("full block carries bounded-Read sentence with hashline/plan_read note", () => {
    //#given ctx tools present so the full block renders
    _setCtxToolsForTesting(true)

    //#when built
    const block = buildContextModeRoutingBlock()

    //#then bounded-Read guidance present (substring, not full sentence)
    expect(block).toContain("Read is CORRECT when you intend to Edit")
    expect(block).toContain("hashline")
    expect(block).toContain("plan_read")
  })

  test("fallback block carries the same bounded-Read sentence", () => {
    //#given the warn-only fallback path
    //#when built
    const block = buildFallbackRoutingBlock()

    //#then same bounded-Read carve-out, no tool-hierarchy change
    expect(block).toContain("Read is CORRECT when you intend to Edit")
    expect(block).toContain("hashline")
    expect(block).toContain("plan_read")
  })
})
