/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

const SRC = join(import.meta.dir, "../../../src")

function readSrc(rel: string): string {
  return readFileSync(join(SRC, rel), "utf-8")
}

function makeTask(): BackgroundTask {
  return {
    id: "bg_fields",
    sessionID: "ses_fields",
    parentSessionID: "parent",
    parentMessageID: "message",
    description: "field surface",
    prompt: "do work",
    agent: "mouse",
    status: "running",
    progress: {
      toolCalls: 1,
      lastTool: "bash",
      lastUpdate: new Date(0),
      lastMessage: "working",
    },
  }
}

describe("BackgroundTask field surface", () => {
  test("a fresh task has no compactedResult or stability counters", () => {
    //#given a task built from the trimmed type
    const task = makeTask()

    //#when inspecting the runtime object shape
    //#then the removed fields are absent
    expect("compactedResult" in task).toBe(false)
    expect("lastMsgCount" in task).toBe(false)
    expect("stablePolls" in task).toBe(false)
  })

  test("progress no longer exposes the removed keys", () => {
    //#given a task with the retained progress snapshot
    const task = makeTask()
    const progress = task.progress ?? {}

    //#when inspecting the runtime progress shape
    //#then the removed progress keys are absent
    expect("lastMessageAt" in progress).toBe(false)
    expect("toolCallWindow" in progress).toBe(false)
    expect("countedToolPartIDs" in progress).toBe(false)
  })

  test("the type declaration no longer lists the removed fields", () => {
    //#given the background-agent types source
    const source = readSrc("features/background-agent/types.ts")

    //#when scanning for the removed declarations
    //#then every removed field and the orphaned window type are gone
    expect(source).not.toMatch(/interface\s+ToolCallWindow\b/)
    expect(source).not.toMatch(/toolCallWindow\??\s*:/)
    expect(source).not.toMatch(/lastMessageAt\??\s*:/)
    expect(source).not.toMatch(/countedToolPartIDs\??\s*:/)
    expect(source).not.toMatch(/lastMsgCount\??\s*:/)
    expect(source).not.toMatch(/stablePolls\??\s*:/)
    expect(source).not.toMatch(/compactedResult\??\s*:/)
  })
})
