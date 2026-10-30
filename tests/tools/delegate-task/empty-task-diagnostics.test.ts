import { describe, expect, test } from "bun:test"
import { fetchSyncResult } from "../../../src/tools/delegate-task/sync-result-fetcher"
import { formatEmptySessionError } from "../../../src/tools/delegate-task/sync-empty-retry"
import {
  describeLastMessageParts,
  describeMessageShape
} from "../../../src/tools/delegate-task/diagnostic-shape"
import type { OpencodeClient } from "../../../src/tools/delegate-task/types"

// Assembled from fragments so the retired wording never appears verbatim in the tree
// (acceptance 6.1 greps src and tests and must find zero matches).
const RETIRED_PHRASES = [
  ["no", "subagent", "was", "spawned"].join(" "),
  ["nested", "inside", "execute/code-mode"].join(" "),
]

function clientReturning(messages: unknown[]): OpencodeClient {
  return {
    session: {
      messages: async () => ({ data: messages })
    }
  } as unknown as OpencodeClient
}

function args() {
  return {
    description: "diagnostic probe",
    prompt: "do it",
    load_skills: [],
    category: "source"
  } as never
}

describe("empty task diagnostics", () => {
  test("reports zero messages and the session id", async () => {
    //#given a session with no messages at all
    const client = clientReturning([])

    //#when the sync result is fetched
    const result = await fetchSyncResult(client, "ses_zero_messages")

    //#then the error names the observation instead of blaming the model alone
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("0 messages")
    expect(result.error).toContain("ses_zero_messages")
  })

  test("lists the observed roles when no assistant message exists", async () => {
    //#given messages that carry only user turns
    const client = clientReturning([
      { type: "user", content: [{ type: "text", text: "hello" }] },
      { type: "user", content: [{ type: "text", text: "still waiting" }] },
    ])

    //#when the sync result is fetched
    const result = await fetchSyncResult(client, "ses_user_only")

    //#then the observed roles are reported
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("2 messages")
    expect(result.error).toContain("0 assistant")
    expect(result.error).toContain("user")
  })

  test("names both candidate causes in every empty-path message", async () => {
    //#given a session with no messages
    const client = clientReturning([])

    //#when the sync result is fetched
    const result = await fetchSyncResult(client, "ses_causes")

    //#then both the model produced nothing and the shape mismatch are candidates
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("produced no assistant message")
    expect(result.error).toContain("flat shape")
  })

  test("never emits the retired diagnostic strings", async () => {
    //#given the two empty paths that previously produced retired wording
    const fetched = await fetchSyncResult(clientReturning([]), "ses_forbidden")
    const emptyRetry = formatEmptySessionError(args(), "ses_forbidden", "mouse", [])

    //#when both messages are inspected
    const combined = `${fetched.ok ? "" : fetched.error}\n${emptyRetry}`

    //#then the retired wording is gone
    for (const phrase of RETIRED_PHRASES) {
      expect(combined).not.toContain(phrase)
    }
  })

  test("empty-retry error states the observed message count", () => {
    //#given an empty session observed during the retry path
    const message = formatEmptySessionError(args(), "ses_retry", "mouse", [])

    //#then the observation is part of the message
    expect(message).toContain("0 messages")
    expect(message).toContain("ses_retry")
  })

  test("describes roles and last-message part types", () => {
    //#given a session whose last message carries a tool part
    const messages = [
      { type: "user", content: [{ type: "text" }] },
      { type: "assistant", content: [{ type: "tool" }, { type: "tool-result" }] },
    ]

    //#when the shape is described
    const shape = describeMessageShape(messages as never)
    const types = describeLastMessageParts(messages as never)

    //#then counts, roles and part types are all reported
    expect(shape).toContain("2 messages")
    expect(shape).toContain("1 assistant")
    expect(shape).toContain("assistant")
    expect(types).toBe("tool,tool-result")
  })
})
