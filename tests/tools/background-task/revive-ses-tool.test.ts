/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { createBackgroundRevive } from "../../../src/tools/background-task/create-background-revive"

const testContext = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "morpheus",
  abort: new AbortController().signal,
}

function extractMetadata(output: string): Record<string, unknown> {
  const match = output.match(/<task_metadata>([\s\S]*?)<\/task_metadata>/)
  if (!match) throw new Error(`no <task_metadata> block found in output: ${output}`)
  return JSON.parse(match[1]) as Record<string, unknown>
}

function fakeManager(overrides: Partial<Record<"revive" | "listRevivable", unknown>>): BackgroundManager {
  return {
    revive: async () => {
      throw new Error("revive() should not have been called")
    },
    listRevivable: () => [],
    ...overrides,
  } as unknown as BackgroundManager
}

describe("createBackgroundRevive ses_ path", () => {
  test("session_id is forwarded to manager.revive and a transient success parses", async () => {
    //#given a manager that revives an owned native session into a transient
    let received: Record<string, unknown> | undefined
    const tool = createBackgroundRevive(
      fakeManager({
        revive: async (input: Record<string, unknown>) => {
          received = input
          return { id: "ses_owned01", sessionID: "ses_owned01", status: "running" }
        },
      }),
      process.cwd(),
    )

    //#when reviving by session_id
    const result = await tool.execute({ session_id: "ses_owned01", prompt: "continue" }, testContext)

    //#then the session_id reaches the manager and the outcome is revived
    expect(received?.sessionId).toBe("ses_owned01")
    expect(received?.parentSessionID).toBe("parent-session")
    const metadata = extractMetadata(result)
    expect(metadata.task_id).toBe("ses_owned01")
    expect(metadata.session_id).toBe("ses_owned01")
    expect(metadata.reason).toBe("revived")
  })

  test("bg_-only refusal maps to no-session", async () => {
    //#given a manager that refuses an unmapped native session
    const tool = createBackgroundRevive(
      fakeManager({
        revive: async () => {
          throw new Error(
            "Cannot revive native session ses_ghost01: revive is bg_-only (background handles only). Use background_output/session_read to inspect it.",
          )
        },
      }),
      process.cwd(),
    )

    //#when the revive is attempted
    const result = await tool.execute({ session_id: "ses_ghost01", prompt: "retry" }, testContext)

    //#then the stable reason is no-session
    expect(extractMetadata(result).reason).toBe("no-session")
  })

  test("ownership-mismatch refusal maps to unknown-task with detail", async () => {
    //#given a manager that refuses a foreign-parent native session
    const tool = createBackgroundRevive(
      fakeManager({
        revive: async () => {
          throw new Error(
            "Cannot revive native session ses_owned02: owned by another parent session (ownership mismatch). Only the owning parent can re-prompt it.",
          )
        },
      }),
      process.cwd(),
    )

    //#when the revive is attempted
    const result = await tool.execute({ session_id: "ses_owned02", prompt: "retry" }, testContext)

    //#then the stable reason is unknown-task and the detail names the mismatch
    expect(extractMetadata(result).reason).toBe("unknown-task")
    expect(result).toContain("ownership mismatch")
  })
})
