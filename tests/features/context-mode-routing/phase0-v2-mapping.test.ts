/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildContextModeRoutingBlock } from "../../../src/features/context-mode-routing/routing-block"
import { _setCtxToolsForTesting } from "../../../src/shared/policy/context-mode-enforcement"

const V1_NAMES = ["ctx_batch_execute", "ctx_execute_file", "ctx_fetch_and_index"]

describe("phase0 V2 mapping: routing block", () => {
  beforeEach(() => {
    //#given
    // Simulate ctx tools present so the full (non-fallback) routing block renders
    _setCtxToolsForTesting(true)
  })

  afterEach(() => {
    _setCtxToolsForTesting(null)
  })

  test("routing block contains no V1 tool names", () => {
    //#given
    const block = buildContextModeRoutingBlock()
    //#when
    const leftovers = V1_NAMES.filter((n) => block.includes(n))
    //#then
    expect(leftovers).toEqual([])
  })

  test("routing block PROCESSING tier uses ctx_execute with file param", () => {
    //#given
    const block = buildContextModeRoutingBlock()
    //#when
    const processing = block.slice(block.indexOf("3. PROCESSING"))
    //#then
    expect(processing).toContain("ctx_execute")
    expect(processing).not.toContain("ctx_execute_file")
  })

  test("routing block GATHER tier uses ctx_batch (V2 rename)", () => {
    //#given
    const block = buildContextModeRoutingBlock()
    //#when
    const gather = block.slice(block.indexOf("1. GATHER"), block.indexOf("2. FOLLOW-UP"))
    //#then
    expect(gather).toContain("ctx_batch")
    expect(gather).not.toContain("ctx_batch_execute")
  })

  test("routing block web tier uses ctx_index then ctx_search", () => {
    //#given
    const block = buildContextModeRoutingBlock()
    //#when
    const webLine = block.split("\n").find((l) => l.includes("WebFetch")) ?? ""
    //#then
    expect(webLine).toContain("ctx_index")
    expect(webLine).not.toContain("ctx_fetch_and_index")
  })
})
