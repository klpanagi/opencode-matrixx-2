/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

describe("hideNativeSubagentTool removal (Phase 5.3)", () => {
  // NOTE (Phase 5.3): the helper was deleted — native `subagent` is THE
  // delegation path now. These pins assert it stays gone.
  test("assemble module no longer defines hideNativeSubagentTool", async () => {
    //#given
    const source = await Bun.file("src/plugin/setup-domains/assemble.ts").text()
    //#when
    const mentions = source.split("\n").filter((line) => line.includes("hideNativeSubagentTool"))
    //#then
    expect(mentions).toEqual([])
  })
  test("setup-domains barrel no longer re-exports hideNativeSubagentTool", async () => {
    //#given
    const source = await Bun.file("src/plugin/setup-domains.ts").text()
    //#when
    const mentions = source.split("\n").filter((line) => line.includes("hideNativeSubagentTool"))
    //#then
    expect(mentions).toEqual([])
  })
})
