import { describe, expect, it } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { getLastUserRetryParts } from "../../../src/hooks/runtime-fallback/last-user-retry-parts"
import { extractSessionMessages } from "../../../src/hooks/runtime-fallback/session-messages"
import { hasVisibleAssistantResponse } from "../../../src/hooks/runtime-fallback/visible-assistant-response"

function createCtx(messagesResponse: unknown): Parameters<ReturnType<typeof hasVisibleAssistantResponse>>[0] {
  return {
    session: { context: async () => messagesResponse },
    directory: "/tmp/golden",
  } as unknown as Parameters<ReturnType<typeof hasVisibleAssistantResponse>>[0]
}

const neverAutoRetry = () => false

describe("runtime-fallback golden (flat V2 messages)", () => {
  it("still enumerates every message, because the extractor is shape-agnostic", () => {
    // given a flat V2 transcript
    const messages = loadCorpus("v2-flat")

    // when extracting session messages
    const extracted = extractSessionMessages(messages)

    // then all four messages survive extraction
    expect(extracted?.length).toBe(4)
  })

  it("reads retry parts from the newest flat user turn", () => {
    // given a flat V2 transcript whose newest user turn is msg_v2_user_2
    const messages = loadCorpus("v2-flat")

    // when collecting the last user retry parts
    const parts = getLastUserRetryParts(messages)

    // then the newest user text is returned
    expect(parts).toEqual([{ type: "text", text: "Thanks. Is it a flake?" }])
  })

  it("reads retry parts from a data envelope with the same result", () => {
    // given the same transcript wrapped in the SDK data envelope
    const messages = loadCorpus("v2-flat")

    // when collecting retry parts from the envelope
    const parts = getLastUserRetryParts({ data: messages })

    // then the envelope changes nothing
    expect(parts).toEqual([{ type: "text", text: "Thanks. Is it a flake?" }])
  })

  it("reads no retry parts from a V1-shaped transcript", () => {
    // given a V1-shaped transcript
    const messages = loadCorpus("v1-shaped")

    // when collecting the last user retry parts
    const parts = getLastUserRetryParts(messages)

    // then nothing is returned, because the reader now speaks the flat shape only
    expect(parts).toEqual([])
  })

  it("reports a visible assistant response for a flat V2 transcript", async () => {
    // given a flat V2 transcript served by the session client
    const ctx = createCtx(loadCorpus("v2-flat"))

    // when asking whether the assistant produced a visible response
    const visible = await hasVisibleAssistantResponse(neverAutoRetry)(ctx, "ses_golden", undefined)

    // then the newest assistant text is visible, so no retry is needed
    expect(visible).toBe(true)
  })
})
