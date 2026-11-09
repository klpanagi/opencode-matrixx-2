/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { BgHandleSchema, toHandle } from "../../../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

const legacyHandle = {
  taskId: "bg_legacy",
  parentSessionID: "ses_parent",
  parentMessageID: "msg_parent",
  description: "legacy handle",
  agent: "mouse",
  status: "completed",
  progress: {
    toolCalls: 3,
    lastTool: "bash",
    lastUpdate: 1_767_225_600_000,
    lastMessage: "done",
    lastMessageAt: 1_767_225_630_000,
    toolCallWindow: { lastSignature: "sig", consecutiveCount: 2, threshold: 3 },
    countedToolPartIDs: ["part_1"],
  },
}

function makeTask(): BackgroundTask {
  return {
    id: "bg_current",
    sessionID: "ses_current",
    parentSessionID: "parent",
    parentMessageID: "message",
    description: "current handle",
    prompt: "do work",
    agent: "mouse",
    status: "completed",
    progress: {
      toolCalls: 1,
      lastTool: "bash",
      lastUpdate: new Date(1_767_225_600_000),
      lastMessage: "done",
    },
  }
}

describe("handle compatibility", () => {
  test("legacy handles with removed progress keys still parse", () => {
    //#given a handle JSON written by an older build
    //#when parsing it through the current schema
    const result = BgHandleSchema.safeParse(legacyHandle)

    //#then parsing succeeds and the known progress keys survive
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.progress?.toolCalls).toBe(3)
      expect(result.data.progress?.lastMessage).toBe("done")
    }
  })

  test("toHandle no longer projects the removed progress keys", () => {
    //#given a current task
    //#when projecting it onto a handle
    const handle = toHandle(makeTask())

    //#then the persisted progress is the retained subset only
    expect(handle.progress).toEqual({
      toolCalls: 1,
      lastTool: "bash",
      lastUpdate: 1_767_225_600_000,
      lastMessage: "done",
    })
  })
})
