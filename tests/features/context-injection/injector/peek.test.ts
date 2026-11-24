import { describe, expect, it } from "bun:test"
import {
  ContextCollector,
  _resetContextCollectorForTesting,
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../../../src/features/context-injection/injector"

describe("ContextCollector.peek", () => {
  it("returns pending content without clearing it", () => {
    //#given a session with pending context
    const collector = new ContextCollector()
    const sessionID = "ses_peek_keep"
    collector.register(sessionID, { id: "ctx", source: "custom", content: "Keep me" })

    //#when peeking at the pending context
    const peeked = collector.peek(sessionID)

    //#then the content is returned and the store is untouched
    expect(peeked.hasContent).toBe(true)
    expect(peeked.merged).toBe("Keep me")
    expect(collector.hasPending(sessionID)).toBe(true)
  })

  it("reports no content for an empty session without throwing", () => {
    //#given an empty collector
    const collector = new ContextCollector()

    //#when peeking at a session that has nothing pending
    const peeked = collector.peek("ses_peek_empty")

    //#then an empty result is returned
    expect(peeked.hasContent).toBe(false)
    expect(peeked.merged).toBe("")
    expect(peeked.entries).toHaveLength(0)
  })

  it("keeps consume's clearing semantics after a peek", () => {
    //#given a session with pending context
    const collector = new ContextCollector()
    const sessionID = "ses_peek_then_consume"
    collector.register(sessionID, { id: "ctx", source: "custom", content: "Cleared" })

    //#when peeking first and consuming only on a successful injection
    collector.peek(sessionID)
    const consumed = collector.consume(sessionID)

    //#then consume still drains the session
    expect(consumed.merged).toBe("Cleared")
    expect(collector.hasPending(sessionID)).toBe(false)
  })
})

describe("_resetContextCollectorForTesting", () => {
  it("clears pending context on the shared collector instance", () => {
    //#given the shared collector holds context for a session
    contextCollector.register("ses_reset_shared", {
      id: "ctx",
      source: "custom",
      content: "Reset me",
    })
    expect(contextCollector.hasPending("ses_reset_shared")).toBe(true)

    //#when the dispose/test reset runs
    _resetContextCollectorForTesting()

    //#then nothing remains pending
    expect(contextCollector.hasPending("ses_reset_shared")).toBe(false)
  })
})

describe("legacy injector peek-then-clear", () => {
  const createMessage = (
    role: "user" | "assistant",
    sessionID: string,
    parts: Array<{ type?: string; text?: string }>,
  ) => ({
    info: { id: `msg_${role}_${sessionID}`, sessionID, role },
    parts,
  })

  it("preserves pending context across an image-only turn, injecting on the next text turn", async () => {
    //#given a legacy hook, pending context, and an image-only last user message
    const collector = new ContextCollector()
    const hook = createContextInjectorMessagesTransformHook(collector)
    const sessionID = "ses_legacy_image_only"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Surviving context",
    })
    const messages = [createMessage("user", sessionID, [{ type: "image" }])]
    const imageOnlyTurn = { messages } as { messages: typeof messages }

    //#when the legacy transform runs on the image-only turn
    await hook["experimental.chat.messages.transform"]?.({}, imageOnlyTurn)

    //#then the pending content is preserved and no part is injected
    expect(collector.hasPending(sessionID)).toBe(true)
    expect(imageOnlyTurn.messages[0].parts).toHaveLength(1)

    //#when a later normal text turn runs through the transform
    const textMessages = [createMessage("user", sessionID, [{ type: "text", text: "Follow-up" }])]
    const textTurn = { messages: textMessages } as { messages: typeof textMessages }
    await hook["experimental.chat.messages.transform"]?.({}, textTurn)

    //#then the surviving context is injected before the text part, then consumed
    expect(textTurn.messages[0].parts).toHaveLength(2)
    expect(textTurn.messages[0].parts[0].text).toBe("Surviving context")
    expect(textTurn.messages[0].parts[1].text).toBe("Follow-up")
    expect(collector.hasPending(sessionID)).toBe(false)
  })
})
