/// <reference types="bun-types" />
const { describe, test, expect, beforeEach } = require("bun:test")
import { tmpdir } from "node:os"
import type { MatrixxContext } from "../../../src/plugin/context"
import type { V2Event } from "../../../src/plugin/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import {
  _resetForTesting,
  registerSubagentSession,
  unregisterSubagentSession,
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

describe("waitForAllDescendants native gate", () => {
  beforeEach(() => {
    //#given
    _resetForTesting()
  })

  test("returns immediately empty when no descendants", async () => {
    //#given
    const manager = createManager()
    //#when
    const result = await manager.waitForAllDescendants("ses_lonely", 50, 10)
    //#then
    expect(result.completed).toEqual([])
    expect(result.timedOut).toEqual([])
  })

  test("unregistered native is not reported (fresh manager cache is empty)", async () => {
    //#given
    // Cache is per-manager-instance: a fresh manager starts with an empty
    // cache, so register-then-unregister before any read is deterministic
    // regardless of TTL. Same-manager staleness is covered below.
    const manager = createManager()
    registerSubagentSession("ses_gone", "ses_parent")
    unregisterSubagentSession("ses_gone")
    //#when
    const result = await manager.waitForAllDescendants("ses_parent", 50, 10)
    //#then
    expect(result.completed).toEqual([])
    expect(result.timedOut).toEqual([])
  })

  test("mixed completed bg_ task plus live native reports both partitions", async () => {
    //#given
    const manager = createManager()
    const tracked = await manager.trackTask({
      taskId: "bg_1",
      sessionID: "ses_bg",
      parentSessionID: "ses_parent",
      description: "bg work",
    })
    tracked.status = "completed"
    registerSubagentSession("ses_nat", "ses_parent")
    //#when
    const result = await manager.waitForAllDescendants("ses_parent", 50, 10)
    //#then
    expect(result.completed.map((r) => r.id)).toContain("bg_1")
    expect(result.timedOut.map((r) => r.id)).toContain("ses_nat")
    expect(result.timedOut.find((r) => r.id === "ses_nat")?.agent).toBe("native")
  })

  test("same-manager reread within TTL serves cached rows after unregister", () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_cached", "ses_parent")
    const primed = manager.getNativeDescendants("ses_parent")
    expect(primed.map((d) => d.sessionId)).toContain("ses_cached")
    unregisterSubagentSession("ses_cached")
    //#when
    const reread = manager.getNativeDescendants("ses_parent")
    //#then
    expect(reread.map((d) => d.sessionId)).toContain("ses_cached")
  })

  test("terminal handleEvent clears the cache so reread is fresh", async () => {
    //#given
    // Prime the cache while ses_nat is live, then unregister it: without
    // invalidation the reread below would serve the stale cached row.
    const manager = createManager()
    registerSubagentSession("ses_nat", "ses_parent")
    expect(
      manager.getNativeDescendants("ses_parent").map((d) => d.sessionId),
    ).toContain("ses_nat")
    await manager.trackTask({
      taskId: "bg_9",
      sessionID: "ses_bg9",
      parentSessionID: "ses_parent",
      description: "bg work",
    })
    unregisterSubagentSession("ses_nat")
    //#when
    manager.handleEvent({
      type: "session.idle",
      data: { sessionID: "ses_bg9" },
    } as unknown as V2Event)
    //#then
    const reread = manager.getNativeDescendants("ses_parent")
    expect(reread.map((d) => d.sessionId)).toEqual(["ses_bg9"])
  })
})
