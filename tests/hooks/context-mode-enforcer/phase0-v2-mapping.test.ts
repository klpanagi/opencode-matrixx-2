/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  BASH_ROUTED_MESSAGE,
  BLOCK_MESSAGE_GREP_GLOB,
  WARN_MESSAGE_BASH_READ,
  WARN_MESSAGE_READ,
  WEBFETCH_BLOCK_MESSAGE,
} from "../../../src/hooks/context-mode-enforcer/constants"

const V1_NAMES = ["ctx_batch_execute", "ctx_execute_file", "ctx_fetch_and_index"]
const ALL_MESSAGES = [
  WARN_MESSAGE_READ,
  BLOCK_MESSAGE_GREP_GLOB,
  WARN_MESSAGE_BASH_READ,
  WEBFETCH_BLOCK_MESSAGE,
  BASH_ROUTED_MESSAGE,
]

describe("phase0 V2 mapping: enforcer constants", () => {
  test("constants contain no V1 tool names", () => {
    //#given
    const combined = ALL_MESSAGES.join("\n")
    //#when
    const leftovers = V1_NAMES.filter((n) => combined.includes(n))
    //#then
    expect(leftovers).toEqual([])
  })

  test("read guidance points at ctx_execute with file param (V2)", () => {
    //#given
    const msg = WARN_MESSAGE_READ
    //#when
    const mentionsV2Execute = msg.includes("ctx_execute")
    //#then
    expect(mentionsV2Execute).toBe(true)
    expect(msg).not.toContain("ctx_execute_file")
  })

  test("grep/glob guidance points at ctx_batch (V2 rename)", () => {
    //#given
    const msg = BLOCK_MESSAGE_GREP_GLOB
    //#when
    const mentionsV2Batch = msg.includes("ctx_batch")
    //#then
    expect(mentionsV2Batch).toBe(true)
    expect(msg).not.toContain("ctx_batch_execute")
  })

  test("webfetch guidance points at ctx_index then ctx_search (V2 two-step)", () => {
    //#given
    const msg = WEBFETCH_BLOCK_MESSAGE
    //#when
    const mentionsIndex = msg.includes("ctx_index")
    //#then
    expect(mentionsIndex).toBe(true)
    expect(msg).not.toContain("ctx_fetch_and_index")
  })
})
