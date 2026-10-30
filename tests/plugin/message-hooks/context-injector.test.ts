import { describe, expect, test } from "bun:test"
import { ContextCollector } from "../../../src/features/context-injector"
import type { MatrixxContext } from "../../../src/plugin/context"
import {
  applyContextInjectorMessagesTransform,
  registerContextInjectorMessagesTransform,
  type FlatMessageHookEvent,
} from "../../../src/plugin/message-hooks/context-injector"
import type { SessionMessage } from "../../../src/shared/session-message"

function flatMessages(texts: Array<{ type: string; text?: string; content?: Array<{ type?: string; text?: string }> }>): SessionMessage[] {
  return texts.map((t) => ({ ...t }) as SessionMessage)
}

function userEvent(sessionID: string, texts: Array<{ type: string; text?: string; content?: Array<{ type?: string; text?: string }> }>): FlatMessageHookEvent {
  return { sessionID, messages: flatMessages(texts) }
}

function makeRecordingCtx(): {
  ctx: MatrixxContext
  seen: Array<{ kind: string; cb: (event: never) => Promise<void> }>
} {
  const seen: Array<{ kind: string; cb: (event: never) => Promise<void> }> = []
  const ctx = {
    session: {
      hook: async (kind: string, cb: (event: never) => Promise<void>) => {
        seen.push({ kind, cb })
        return { dispose: async () => {} }
      },
    },
  } as unknown as MatrixxContext
  return { ctx, seen }
}

describe("contextInjectorMessagesTransform flat port", () => {
  test("prepends pending context to the last user message", async () => {
    //#given pending collector content and three flat messages
    const collector = new ContextCollector()
    const sessionID = "ses_transform1"
    collector.register(sessionID, {
      id: "ulw",
      source: "keyword-detector",
      content: "Ultrawork context",
    })
    const event = userEvent(sessionID, [
      { type: "user", text: "First message" },
      { type: "assistant", text: "Response" },
      { type: "user", text: "Second message" },
    ])
    //#when applying the flat port
    await applyContextInjectorMessagesTransform(event, { collector })
    //#then the merged context is prepended to the last user text, mirroring the V1 synthetic-part splice
    expect(event.messages).toHaveLength(3)
    expect(event.messages[2].text).toBe("Ultrawork context\n\n---\n\nSecond message")
    expect(event.messages[0].text).toBe("First message")
  })

  test("does nothing when no pending context", async () => {
    //#given an empty collector and a flat user message
    const collector = new ContextCollector()
    const sessionID = "ses_transform2"
    const event = userEvent(sessionID, [{ type: "user", text: "Hello world" }])
    //#when applying the flat port
    await applyContextInjectorMessagesTransform(event, { collector })
    //#then the message is untouched
    expect(event.messages).toHaveLength(1)
    expect(event.messages[0].text).toBe("Hello world")
  })

  test("does nothing when no user messages, preserving pending", async () => {
    //#given pending content but only an assistant message with empty content
    const collector = new ContextCollector()
    const sessionID = "ses_transform3"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const event = userEvent(sessionID, [{ type: "assistant", content: [] }])
    //#when applying the flat port
    await applyContextInjectorMessagesTransform(event, { collector })
    //#then nothing mutates and the pending content is preserved, as in V1
    expect(event.messages).toHaveLength(1)
    expect(collector.hasPending(sessionID)).toBe(true)
  })

  test("consumes context after injection", async () => {
    //#given pending collector content and a flat user message
    const collector = new ContextCollector()
    const sessionID = "ses_transform4"
    collector.register(sessionID, {
      id: "ctx",
      source: "keyword-detector",
      content: "Context",
    })
    const event = userEvent(sessionID, [{ type: "user", text: "Message" }])
    //#when applying the flat port
    await applyContextInjectorMessagesTransform(event, { collector })
    //#then the collector is drained
    expect(collector.hasPending(sessionID)).toBe(false)
  })

  test("empty messages[] is a no-op that does not throw", async () => {
    //#given an empty flat message list with pending content registered
    const collector = new ContextCollector()
    collector.register("ses-1", { id: "ctx", source: "keyword-detector", content: "Context" })
    //#when applying the flat port
    await applyContextInjectorMessagesTransform({ sessionID: "ses-1", messages: [] }, { collector })
    //#then nothing throws and the pending content is preserved
    expect(collector.hasPending("ses-1")).toBe(true)
  })

  test("registers on context and compaction, per its mapping-table row", async () => {
    //#given a recording session double
    const { ctx, seen } = makeRecordingCtx()
    //#when registering the flat port
    const registrations = await registerContextInjectorMessagesTransform(ctx)
    //#then both context and compaction registrations exist
    expect(seen.map((s) => s.kind).sort()).toEqual(["compaction", "context"])
    expect(registrations).toHaveLength(2)
    //#when invoking each registered callback with an empty event
    for (const { cb } of seen) {
      await cb({} as never)
    }
    //#then neither throws (Task 26 empty-input contract)
  })

  test("compaction registration injects into the flat event in place", async () => {
    //#given a recording session double and pending content
    const { ctx, seen } = makeRecordingCtx()
    const collector = new ContextCollector()
    await registerContextInjectorMessagesTransform(ctx, { collector })
    const compaction = seen.find((s) => s.kind === "compaction")
    expect(compaction).toBeDefined()
    collector.register("ses-9", { id: "ctx", source: "custom", content: "Compacted context" })
    const event = { sessionID: "ses-9", messages: [{ type: "user", text: "Hi" }] }
    //#when invoking the compaction callback with a flat event
    await compaction?.cb(event as never)
    //#then the same event object carries the injected text
    expect((event.messages[0] as { text?: string }).text).toBe("Compacted context\n\n---\n\nHi")
  })
})
