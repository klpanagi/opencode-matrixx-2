import { describe, expect, it } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { getLastUserRetryParts } from "../../../src/hooks/runtime-fallback/last-user-retry-parts"
import { extractSessionMessages } from "../../../src/hooks/runtime-fallback/session-messages"
import { hasVisibleAssistantResponse } from "../../../src/hooks/runtime-fallback/visible-assistant-response"

function createCtx(messagesResponse: unknown): Parameters<ReturnType<typeof hasVisibleAssistantResponse>>[0] {
  return {
    client: { session: { messages: async () => messagesResponse } },
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

  it("finds no retry parts when the last user message hides its role at the top level", () => {
    // given a flat V2 transcript whose newest user turn is msg_v2_user_2
    const messages = loadCorpus("v2-flat")

    // when collecting the last user retry parts
    const parts = getLastUserRetryParts(messages)

    // then nothing is returned, because the reader looks for info.role
    // (task 15 flips this expectation to the msg_v2_user_2 text once accessors land)
    expect(parts).toEqual([])
  })

  it("reads retry parts from a data envelope with the same result", () => {
    // given the same transcript wrapped in the SDK data envelope
    const messages = loadCorpus("v2-flat")

    // when collecting retry parts from the envelope
    const parts = getLastUserRetryParts({ data: messages })

    // then the envelope changes nothing
    expect(parts).toEqual([])
  })

  it("reads retry parts from a V1-shaped user message (contract kept after accessors)", () => {
    // given a V1-shaped transcript
    const messages = loadCorpus("v1-shaped")

    // when collecting the last user retry parts
    const parts = getLastUserRetryParts(messages)

    // then the newest user text is returned
    expect(parts).toEqual([{ type: "text", text: "Thanks. Is it a flake?" }])
  })

  it("reports no visible assistant response for a flat V2 transcript", async () => {
    // given a flat V2 transcript served by the session client
    const ctx = createCtx({ data: loadCorpus("v2-flat") })

    // when asking whether the assistant produced a visible response
    const visible = await hasVisibleAssistantResponse(neverAutoRetry)(ctx, "ses_golden", undefined)

    // then the hook cannot see the response and would retry forever
    // (task 15 flips this expectation to true once accessors land)
    expect(visible).toBe(false)
  })
})
