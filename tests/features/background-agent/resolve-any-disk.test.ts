/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeHandle } from "../../../src/features/background-agent/handle-index"
import { BackgroundManager, resolveAny } from "../../../src/features/background-agent/manager"
import type { NativePluginContext } from "../../../src/plugin/context"

let dir = ""
const managers: BackgroundManager[] = []
afterEach(() => {
  for (const m of managers) {
    try { m.shutdown() } catch { /* ignore */ }
  }
  managers.length = 0
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ""
})

function makeCtx(directory: string): NativePluginContext {
  return {
    directory,
    session: {
      create: async () => ({ id: "ses_new" }),
      prompt: async () => ({}),
      messages: async () => [],
      get: async () => ({}),
      list: async () => [],
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  } as unknown as NativePluginContext
}

describe("resolveAny disk fallback (A)", () => {
  test("ses_ covered by a persisted bg_ handle resolves as bg, not read-only", async () => {
    //#given a persisted handle whose session survives but memory does not (restart/TTL eviction)
    dir = mkdtempSync(join(tmpdir(), "matrixx-resolve-disk-"))
    writeHandle(dir, {
      id: "bg_disk123",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "persisted work",
      prompt: "work",
      agent: "mouse",
      status: "completed",
      sessionID: "ses_covered999",
    } as never)
    const fresh = new BackgroundManager(makeCtx(dir))
    managers.push(fresh)
    //#when resolving the ses_ id
    const result = await resolveAny(fresh, "ses_covered999")
    //#then it returns the bg task instead of a read-only foreign/ses payload
    expect(result.origin).toBe("bg")
    if (result.origin === "bg") {
      expect(result.task.id).toBe("bg_disk123")
    }
  })
})
