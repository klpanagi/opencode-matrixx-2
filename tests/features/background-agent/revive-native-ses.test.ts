/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BackgroundManager } from "../../../src/features/background-agent/manager"
import {
  registerSubagentSession,
  _resetForTesting,
} from "../../../src/features/session-state/state"

let TMP_DIR = ""

function makeClient() {
  const promptCalls: Array<{ sessionID: string; text?: string; [key: string]: unknown }> = []
  const native = {
    session: {
      get: async () => ({ directory: TMP_DIR }),
      create: async () => ({ id: "sess_new" }),
      prompt: async (args: { sessionID: string; text?: string }) => {
        promptCalls.push(args)
        return {}
      },
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return { client: native, promptCalls }
}

function makeManager(client: unknown, dir: string): BackgroundManager {
  return new BackgroundManager({ ...(client as Record<string, unknown>), directory: dir } as never, undefined as never)
}

describe("BackgroundManager.revive native ses_", () => {
  beforeEach(() => {
    TMP_DIR = mkdtempSync(join(tmpdir(), "revive-native-ses-"))
    _resetForTesting()
  })

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true })
    } catch { /* best-effort */ }
    _resetForTesting()
  })

  test("owned ses_ revives via session.prompt and returns running transient", async () => {
    //#given an owned native session registered under the calling parent
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    registerSubagentSession("ses_owned11", "sess_parent11")

    //#when reviving the owned ses_ id
    const revived = await mgr.revive({
      sessionId: "ses_owned11",
      prompt: "continue here",
      parentSessionID: "sess_parent11",
      parentMessageID: "msg_11",
    })

    //#then it prompts the live session and returns a running transient keyed by the ses_ id
    expect(revived.status).toBe("running")
    expect(revived.sessionID).toBe("ses_owned11")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("ses_owned11")
    mgr.shutdown()
  })

  test("foreign parent ses_ is refused with ownership mismatch", async () => {
    //#given a native session owned by a different parent
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    registerSubagentSession("ses_owned12", "sess_other_parent")

    //#when reviving from an unrelated parent
    let thrown: Error | undefined
    try {
      await mgr.revive({
        sessionId: "ses_owned12",
        prompt: "continue here",
        parentSessionID: "sess_parent11",
        parentMessageID: "msg_12",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then an ownership-mismatch refusal is thrown and nothing is prompted
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("ownership mismatch")
    expect(promptCalls.length).toBe(0)
    mgr.shutdown()
  })

  test("unknown non-ses_ id keeps the legacy not-found throw", async () => {
    //#given a manager with no handle for a non-native id
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)

    //#when reviving an unknown bg_-style id
    let thrown: Error | undefined
    try {
      await mgr.revive({
        taskId: "bg_nope123",
        prompt: "continue here",
        parentSessionID: "sess_parent11",
        parentMessageID: "msg_13",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then the legacy not-found message is preserved
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("Task not found for revive")
    mgr.shutdown()
  })
})
