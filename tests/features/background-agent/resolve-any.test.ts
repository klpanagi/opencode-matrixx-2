/// <reference types="bun-types" />
import { describe, test, expect, beforeEach } from "bun:test"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { resolveAny, listKnownSessions } from "../../../src/features/background-agent/manager"
import type { NativePluginContext } from "../../../src/plugin/tool/context"

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

describe("resolveAny origin classification", () => {
  test("reports foreign when native messages resolve but id is not a known session", async () => {
    //#given a native client that resolves messages for an id absent from knownSessions
    const ctx = buildCtx({
      session: {
        messages: async () => [{ role: "user", content: "hi" }],
        list: async () => [],
      },
    })
    const mgr = new BackgroundManager(ctx)

    //#when resolving the ses_ id
    const result = await resolveAny(mgr, "ses_unknown42")

    //#then it is classified foreign, never ses
    expect(result.origin).toBe("foreign")
    if (result.origin === "ses" || result.origin === "foreign") {
      expect(result.sessionId).toBe("ses_unknown42")
    }
  })

  test("reports foreign for an id discovered only by the backfill list sweep", async () => {
    //#given native messages resolve to nothing but the session list contains the id
    const ctx = buildCtx({
      session: {
        messages: async () => undefined,
        list: async () => [{ id: "ses_swept7" }],
      },
    })
    const mgr = new BackgroundManager(ctx)

    //#when resolving the swept ses_ id
    const result = await resolveAny(mgr, "ses_swept7")

    //#then it is classified foreign with an empty output
    expect(result).toEqual({ origin: "foreign", sessionId: "ses_swept7", output: [] })
  })

  test("reports ses with fetched output when the id is a known session", async () => {
    //#given a native client that resolves messages and a remembered known session
    const messages = [{ role: "user", content: "hi" }]
    const ctx = buildCtx({
      session: {
        messages: async () => messages,
        list: async () => [],
      },
    })
    const mgr = new BackgroundManager(ctx)
    mgr.store.rememberKnownSession("ses_known9")

    //#when resolving the known ses_ id
    const result = await resolveAny(mgr, "ses_known9")

    //#then it keeps the ses origin and carries the fetched output
    expect(result.origin).toBe("ses")
    if (result.origin === "ses" || result.origin === "foreign") {
      expect(result.sessionId).toBe("ses_known9")
      expect(result.output).toEqual(messages)
    }
  })

  test("returns not_found for an unrelated ses_ id absent from every source", async () => {
    //#given native messages resolve to nothing and the session list is empty
    const ctx = buildCtx({
      session: {
        messages: async () => undefined,
        list: async () => [],
      },
    })
    const mgr = new BackgroundManager(ctx)

    //#when resolving an unrelated ses_ id
    const result = await resolveAny(mgr, "ses_unrelated5")

    //#then it is a typed not_found error, never ses
    expect(result).toEqual({ error: "not_found", id: "ses_unrelated5" })
  })

  test("does not throw when the disk lookup throws", async () => {
    //#given a manager whose disk lookup fails
    const ctx = buildCtx({
      session: {
        messages: async () => undefined,
        list: async () => [],
      },
    })
    const mgr = new BackgroundManager(ctx)
    mgr.findDiskTaskBySession = () => {
      throw new Error("disk boom")
    }

    //#when resolving a ses_ id
    const result = await resolveAny(mgr, "ses_diskboom3")

    //#then it continues to the native paths without throwing
    expect(result).toEqual({ error: "not_found", id: "ses_diskboom3" })
  })
})
