/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { loadCorpus } from "../../fixtures/messages/loader"
import { extractLatestAssistantText } from "../../../src/tools/look-at/assistant-message-extractor"

describe("golden: look-at assistant text extraction", () => {
  test("returns the newest assistant text from the v1-shaped corpus", () => {
    //#given the v1-shaped corpus, whose newest assistant message is msg_v1_asst_2
    const messages = loadCorpus("v1-shaped")

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBe("No, the fixture drifted.")
  })

  test("joins every text part of the chosen message with a newline", () => {
    //#given a corpus whose newest assistant message carries two text parts plus a reasoning part
    const messages = loadCorpus("v1-shaped")
    const last = messages[messages.length - 1] as { parts: Array<{ type: string; text: string }> }
    last.parts = [
      { type: "text", text: "first" },
      { type: "reasoning", text: "ignored" },
      { type: "text", text: "second" },
    ]

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBe("first\nsecond")
  })

  test("returns null when no assistant message is present", () => {
    //#given a corpus of user messages only
    const messages = (loadCorpus("v1-shaped") as Array<{ info?: { role?: string } }>).filter(
      (message) => message.info?.role === "user",
    )

    //#when
    const text = extractLatestAssistantText(messages)

    //#then
    expect(text).toBeNull()
  })

  test("pins the current v2-flat gap that task 15 closes", () => {
    //#given the v2-flat corpus, whose messages carry type/content instead of info/parts
    const v2 = loadCorpus("v2-flat")

    //#when
    const text = extractLatestAssistantText(v2)

    //#then task 15 flips this expectation to "No, the fixture drifted."
    expect(text).toBeNull()
  })
})
