/// <reference types="bun-types" />
const { describe, test, expect, beforeEach } = require("bun:test")
import { tmpdir } from "node:os"
import type { MatrixxContext } from "../../../src/plugin/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import {
  _resetForTesting,
  registerSubagentSession,
} from "../../../src/features/session-state/state"

function createManager(): BackgroundManager {
  const native = {
    session: {
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory: tmpdir() } as unknown as MatrixxContext)
}

describe("getNativeDescendants", () => {
  beforeEach(() => {
    //#given
    _resetForTesting()
  })

  test("returns [] for unknown session", () => {
    //#given
    const manager = createManager()
    //#when
    const result = manager.getNativeDescendants("ses_unknown")
    //#then
    expect(result).toEqual([])
  })

  test("returns direct child descriptor", () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_child", "ses_parent")
    //#when
    const result = manager.getNativeDescendants("ses_parent")
    //#then
    expect(result).toEqual([{ sessionId: "ses_child", parentSessionId: "ses_parent", isChild: true }])
  })

  test("returns nested grandchild", () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_child", "ses_parent")
    registerSubagentSession("ses_grand", "ses_child")
    //#when
    const result = manager.getNativeDescendants("ses_parent")
    //#then
    expect(result.map((d) => d.sessionId).sort()).toEqual(["ses_child", "ses_grand"])
    expect(result.find((d) => d.sessionId === "ses_grand")?.parentSessionId).toBe("ses_child")
  })

  test("is cycle-safe", () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_a", "ses_b")
    registerSubagentSession("ses_b", "ses_a")
    //#when
    const result = manager.getNativeDescendants("ses_a")
    //#then
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result.map((d) => d.sessionId)).toContain("ses_b")
  })

  test("waitForAllDescendants reports uncovered native child as timedOut", async () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_child", "ses_parent")
    //#when
    const result = await manager.waitForAllDescendants("ses_parent", 50, 10)
    //#then
    expect(result.timedOut.map((r) => r.id)).toContain("ses_child")
    expect(result.timedOut.find((r) => r.id === "ses_child")?.agent).toBe("native")
  })

  test("waitForAllDescendants returns empty rows when no descendants", async () => {
    //#given
    const manager = createManager()
    //#when
    const result = await manager.waitForAllDescendants("ses_lonely", 50, 10)
    //#then
    expect(result.completed).toEqual([])
    expect(result.timedOut).toEqual([])
  })
})
