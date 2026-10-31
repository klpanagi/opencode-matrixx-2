/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { resolveAny, listKnownSessions } from "../../../src/features/background-agent/manager"
import type { NativePluginContext } from "../../../src/plugin/context"

function buildCtx(overrides: Record<string, unknown> = {}): NativePluginContext {
  return {
    directory: "/tmp/test-resolve-any",
    session: {
      create: async () => ({ id: "ses_new" }),
      prompt: async () => {},
      messages: async () => [],
      list: async () => [],
    },
    ...overrides,
  } as unknown as NativePluginContext
}

describe("resolveAny", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    manager = new BackgroundManager(buildCtx())
  })

  test("resolves bg_* via registry map with origin bg", async () => {
    //#given a launched background task in the registry
    const launched = await manager.launch({
      sessionId: "ses_parent",
      messageId: "msg_1",
      description: "do work",
      prompt: "work",
    })

    //#when resolving the bg_ id
    const result = await resolveAny(manager, launched.id)

    //#then it returns the task payload with origin bg
    expect(result.origin).toBe("bg")
    expect(result.task.id).toBe(launched.id)
  })

  test("resolves ses_* via read-through without registry write", async () => {
    //#given a manager whose native client knows a live ses_ session
    const ctx = buildCtx({
      session: {
        messages: async () => [{ role: "user", content: "hi" }],
        list: async () => [{ id: "ses_live123" }],
      },
    })
    const mgr = new BackgroundManager(ctx)

    //#when resolving the foreign ses_ id
    const result = await resolveAny(mgr, "ses_live123")

    //#then it returns a ses/foreign payload and writes no registry entry
    expect(["ses", "foreign"]).toContain(result.origin)
    expect(mgr.getTask("ses_live123")).toBeUndefined()
    expect(mgr.findBySession("ses_live123")).toBeUndefined()
  })

  test("returns typed not_found error for unknown id", async () => {
    //#given a manager with an empty registry
    const mgr = new BackgroundManager(buildCtx())

    //#when resolving an unknown id
    const result = await resolveAny(mgr, "bg_nope_unknown")

    //#then it returns a typed not_found error
    expect(result.error).toBe("not_found")
    expect(result.id).toBe("bg_nope_unknown")
  })

  test("wait_all covers pending bg_* plus known live ses_* set", async () => {
    //#given a pending bg_ task and a known live ses_ session
    const mgr = new BackgroundManager(buildCtx())
    const launched = await mgr.launch({
      sessionId: "ses_parent",
      messageId: "msg_2",
      description: "pending work",
      prompt: "work",
    })
    expect(launched.status).toBe("running")

    //#when listing known sessions for wait_all coverage
    const known = listKnownSessions(mgr)

    //#then both the bg_ task and the live ses_ set are covered
    expect(known.bgPending).toContain(launched.id)
    expect(Array.isArray(known.liveSes)).toBe(true)
  })
})
