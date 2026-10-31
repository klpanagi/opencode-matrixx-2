/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../src/plugin/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import {
  _resetForTesting,
  registerSubagentSession,
} from "../../../src/features/session-state/state"

let dir = ""

beforeEach(() => {
  //#given
  _resetForTesting()
  dir = mkdtempSync(join(tmpdir(), "revive-guard-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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
  return new BackgroundManager(
    { ...native, directory: dir } as unknown as MatrixxContext,
  )
}

describe("revive native-session guard", () => {
  test("rejects revive of a native ses_ session as bg_-only", async () => {
    //#given
    const manager = createManager()
    registerSubagentSession("ses_nat", "ses_parent")
    //#when
    const attempt = manager.revive({
      sessionId: "ses_nat",
      prompt: "new instruction",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    //#then
    await expect(attempt).rejects.toThrow(/bg_-only/)
  })

  test("unknown non-native id still throws Task-not-found", async () => {
    //#given
    const manager = createManager()
    //#when
    const attempt = manager.revive({
      taskId: "bg_nope",
      prompt: "new instruction",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    //#then
    await expect(attempt).rejects.toThrow(/Task not found for revive/)
  })
})
