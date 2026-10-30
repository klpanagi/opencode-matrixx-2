import { describe, expect, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"
import {
  applyDomainKeywordDetector,
  registerDomainKeywordDetector,
  type FlatMessageHookEvent,
} from "../../../src/plugin/message-hooks/domain-keyword-detector"
import type { SessionMessage } from "../../../src/shared/session-message"

function flatEvent(texts: Array<{ type: string; text?: string; content?: Array<{ type?: string; text?: string }> }>): FlatMessageHookEvent {
  return {
    sessionID: "ses-1",
    messages: texts.map((t) => ({ ...t }) as SessionMessage),
  }
}

function textOf(event: FlatMessageHookEvent): string {
  return typeof event.messages[0]?.text === "string" ? (event.messages[0].text as string) : ""
}

function makeRecordingCtx(): {
  ctx: MatrixxContext
  seen: Array<{ kind: string; cb: (event: never) => Promise<void> }>
} {
  //#given a session double that records every hook registration
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

describe("domainKeywordDetector flat port", () => {
  test("injects matching finance skills into the last user message", async () => {
    //#given a flat user message with a domain keyword (V1: info.role=user + text part)
    const event = flatEvent([{ type: "user", text: "fetch OHLCV candles with ccxt" }])
    //#when applying the flat port
    await applyDomainKeywordDetector(event)
    //#then the same hint lands as a text prepend, identical to the V1 splice
    const text = textOf(event)
    expect(text).toContain("[domain-skills]")
    expect(text).toContain("ccxt-rest")
    expect(text).toContain("---")
    expect(text).toContain("fetch OHLCV candles with ccxt")
  })

  test("is a no-op when the message has no domain keywords", async () => {
    //#given a flat user message with no domain keywords
    const event = flatEvent([{ type: "user", text: "just a normal message about nothing" }])
    //#when applying the flat port
    await applyDomainKeywordDetector(event)
    //#then the text is byte-identical
    expect(textOf(event)).toBe("just a normal message about nothing")
  })

  test("targets the last user message, skipping trailing assistant content", async () => {
    //#given a user message followed by an assistant message with empty content blocks
    const event = flatEvent([
      { type: "user", text: "store ticks in influxdb" },
      { type: "assistant", content: [] },
    ])
    //#when applying the flat port
    await applyDomainKeywordDetector(event, undefined)
    //#then the user message is hinted and the assistant message is untouched
    expect(event.messages[0].text).toContain("influxdb-timeseries")
    expect(event.messages[1].content).toEqual([])
  })

  test("is idempotent across repeated passes", async () => {
    //#given a flat user message with a domain keyword
    const event = flatEvent([{ type: "user", text: "use grafana for dashboards" }])
    //#when applying the flat port twice
    await applyDomainKeywordDetector(event)
    await applyDomainKeywordDetector(event)
    //#then the marker appears exactly once
    const occurrences = textOf(event).split("[domain-skills]").length - 1
    expect(occurrences).toBe(1)
    expect(textOf(event)).toContain("grafana-dashboards")
  })

  test("does not route system-directive messages", async () => {
    //#given a system-directive message carrying a domain keyword
    const directive = "[SYSTEM DIRECTIVE: MATRIXX - TASK CONTINUATION] use ccxt"
    const event = flatEvent([{ type: "user", text: directive }])
    //#when applying the flat port
    await applyDomainKeywordDetector(event)
    //#then the text is untouched
    expect(textOf(event)).toBe(directive)
  })

  test("empty messages[] is a no-op that does not throw", async () => {
    //#given an empty flat message list
    const event = flatEvent([])
    //#when applying the flat port
    await applyDomainKeywordDetector(event)
    //#then nothing happens and nothing throws
    expect(event.messages).toEqual([])
  })

  test("assistant message with content:[] and no user message does not crash", async () => {
    //#given only an assistant message with an empty content array
    const event = flatEvent([{ type: "assistant", content: [] }])
    //#when applying the flat port
    await applyDomainKeywordDetector(event)
    //#then nothing throws and nothing mutates
    expect(event.messages).toHaveLength(1)
  })

  test("registers on context only, per its mapping-table row", async () => {
    //#given a recording session double
    const { ctx, seen } = makeRecordingCtx()
    //#when registering the flat port
    const registrations = await registerDomainKeywordDetector(ctx)
    //#then exactly one context registration exists
    expect(seen.map((s) => s.kind)).toEqual(["context"])
    expect(registrations).toHaveLength(1)
    //#when invoking the registered callback with an empty event
    await seen[0].cb({} as never)
    //#then it does not throw (Task 26 empty-input contract)
  })
})
