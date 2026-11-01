/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { hideNativeSubagentTool } from "../../src/plugin/setup-domains"

describe("hideNativeSubagentTool", () => {
  test("removes native subagent tool", () => {
    //#given
    const removed: string[] = []
    const editor = { remove: (id: string) => { removed.push(id) } }
    //#when
    hideNativeSubagentTool(editor as never)
    //#then
    expect(removed).toEqual(["subagent"])
  })
  test("swallows missing-tool error", () => {
    //#given
    const editor = { remove: (_id: string) => { throw new Error("not found") } }
    //#when
    hideNativeSubagentTool(editor as never)
    //#then
    expect(true).toBe(true)
  })
})
