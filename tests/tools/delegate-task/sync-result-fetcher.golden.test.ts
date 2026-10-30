/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { DIAGNOSTIC_CAUSES } from "../../../src/tools/delegate-task/diagnostic-shape"
import type { SessionMessage } from "../../../src/tools/delegate-task/executor-types"
import { fetchSyncResult } from "../../../src/tools/delegate-task/sync-result-fetcher"

const FENCE = String.fromCharCode(96).repeat(3)

function clientReturning(payload: unknown) {
  return {
    session: { context: async () => ({ messages: payload }) },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  } as never
}

function clone(messages: unknown[]): SessionMessage[] {
  return JSON.parse(JSON.stringify(messages)) as SessionMessage[]
}

describe("golden: sync result fetcher over the message corpora", () => {
  test("extracts the newest assistant text", async () => {
    //#given the flat corpus, whose newest assistant message is msg_v2_asst_2
    const messages = clone(loadCorpus("v2-flat"))

    //#when
    const result = await fetchSyncResult(clientReturning(messages), "ses_golden")

    //#then
    expect(result).toEqual({ ok: true, textContent: "No, the fixture drifted." })
  })

  test("returns the deliverable tag body instead of the raw text", async () => {
    //#given the same corpus with the newest assistant content wrapped in a plan tag
    const messages = clone(loadCorpus("v2-flat"))
    messages[messages.length - 1].content = [{ type: "text", text: "<plan>step one</plan>\ntrailing commentary" }]

    //#when
    const result = await fetchSyncResult(clientReturning(messages), "ses_golden", undefined, {
      deliverableTag: "plan",
    })

    //#then
    expect(result).toEqual({ ok: true, textContent: "step one" })
  })

  test("strips an outer fence when only the final text is requested", async () => {
    //#given an assistant message fully wrapped in a fenced block with a language line
    const messages = clone(loadCorpus("v2-flat"))
    messages[messages.length - 1].content = [{ type: "text", text: FENCE + "ts\nconst x = 1\n" + FENCE }]

    //#when
    const result = await fetchSyncResult(clientReturning(messages), "ses_golden", undefined, {
      finalTextOnly: true,
    })

    //#then
    expect(result).toEqual({ ok: true, textContent: "const x = 1" })
  })

  test("reports a typed error when the corpus has no assistant message", async () => {
    //#given a corpus of user messages only
    const messages = clone(loadCorpus("v2-flat")).filter((message) => message.type === "user")

    //#when
    const result = await fetchSyncResult(clientReturning(messages), "ses_golden")

    //#then
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error).toContain("No assistant response found.")
    expect(result.error).toContain("Observed: 2 messages, 0 assistant")
    expect(result.error).toContain(DIAGNOSTIC_CAUSES)
    expect(result.error).toContain("ses_golden")
  })

  test("reports the anchor diagnostic when nothing arrived after the anchor", async () => {
    //#given the corpus and an anchor equal to its full length
    const messages = clone(loadCorpus("v2-flat"))

    //#when
    const result = await fetchSyncResult(clientReturning(messages), "ses_golden", messages.length)

    //#then
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error).toContain("no new messages after the anchor")
    expect(result.error).toContain("Observed: 4 messages, 2 assistant")
  })

  test("reads the flat corpus end to end (the gap task 15 closed)", async () => {
    //#given the flat corpus the fetcher used to skip entirely
    const v2 = loadCorpus("v2-flat")

    //#when
    const result = await fetchSyncResult(clientReturning(v2), "ses_golden")

    //#then
    expect(result).toEqual({ ok: true, textContent: "No, the fixture drifted." })
  })
})
