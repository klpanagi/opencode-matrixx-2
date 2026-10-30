/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { DIAGNOSTIC_CAUSES } from "../../../src/tools/delegate-task/diagnostic-shape"
import type { SessionMessage } from "../../../src/tools/delegate-task/executor-types"
import { isSessionComplete, pollSyncSession } from "../../../src/tools/delegate-task/sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

function createCtx() {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "test-agent",
    abort: new AbortController().signal,
  }
}

function clientReturning(payload: unknown) {
  return {
    session: {
      status: async () => ({ data: { ses_golden: { type: "idle" } } }),
      messages: async () => ({ data: payload }),
    },
  }
}

function clone(messages: unknown[]): SessionMessage[] {
  return JSON.parse(JSON.stringify(messages)) as SessionMessage[]
}

describe("golden: sync session poller over the message corpora", () => {
  beforeEach(() => {
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 5000,
    })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("treats the v1-shaped corpus as a completed session", () => {
    //#given the v1-shaped corpus, whose last assistant message carries finish: "stop"
    const messages = clone(loadCorpus("v1-shaped"))

    //#when
    const complete = isSessionComplete(messages)

    //#then
    expect(complete).toBe(true)
  })

  test("resolves when the polled session reaches a terminal assistant finish", async () => {
    //#given a client that reports an idle session holding the v1-shaped corpus
    const messages = clone(loadCorpus("v1-shaped"))

    //#when
    const result = await pollSyncSession(createCtx() as never, clientReturning(messages) as never, {
      sessionID: "ses_golden",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
    })

    //#then
    expect(result).toBeNull()
  })

  test("stall path reports the task-7 diagnostics when no assistant message ever arrives", async () => {
    //#given a corpus with user messages only, so the poller never sees an assistant turn
    const messages = clone(loadCorpus("v1-shaped")).filter((message) => message.info?.role === "user")

    //#when
    const result = await pollSyncSession(createCtx() as never, clientReturning(messages) as never, {
      sessionID: "ses_golden",
      agentToUse: "test-agent",
      toastManager: null,
      taskId: undefined,
    })

    //#then
    expect(result).not.toBeNull()
    expect(result as string).toContain("Session stalled: no assistant response after")
    expect(result as string).toContain("Observed: 2 messages, 0 assistant")
    expect(result as string).toContain("last message part types: text")
    expect(result as string).toContain(DIAGNOSTIC_CAUSES)
  })

  test("pins the current v2-flat gap that task 15 closes", () => {
    //#given the v2-flat corpus, whose assistant messages carry type/content instead of info/parts
    const v2 = clone(loadCorpus("v2-flat"))

    //#when
    const complete = isSessionComplete(v2)

    //#then task 15 flips this expectation to true
    expect(complete).toBe(false)
  })
})
