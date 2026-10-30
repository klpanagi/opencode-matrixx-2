import { describe, expect, it } from "bun:test"
import * as sessionMessage from "../../src/shared/session-message"
import type { ContentPart, SessionMessage, SessionRole } from "../../src/shared/session-message"

/**
 * Phase 3 shape lock (plan task 17).
 *
 * This module is the only surface every message consumer reads through. It must not
 * silently grow, and it must never regain a V1 shape (`info` / `parts`). The runtime
 * half pins the exact export list; the static half pins the flat type at compile time
 * (enforced by `bun run typecheck`, not by grepping the file at runtime).
 */

const EXPECTED_ACCESSORS = [
  "contentOf",
  "finishOf",
  "idOf",
  "isAssistant",
  "roleOf",
  "textOf",
  "timeOf",
] as const

describe("session-message shared surface", () => {
  it("exports exactly the seven accessors and nothing else at runtime", () => {
    //#given the shared module namespace
    const runtimeExports = Object.keys(sessionMessage).sort()

    //#then the export list is frozen: no new helper, no V1 re-export
    expect(runtimeExports).toEqual([...EXPECTED_ACCESSORS])
  })

  it("exposes every accessor as a tolerant function", () => {
    //#given each expected accessor name
    for (const name of EXPECTED_ACCESSORS) {
      //#then it is callable and accepts arbitrary input without throwing
      const accessor = sessionMessage[name] as (input: unknown) => unknown
      expect(typeof accessor).toBe("function")
      expect(() => accessor(null)).not.toThrow()
      expect(() => accessor(undefined)).not.toThrow()
      expect(() => accessor("nonsense")).not.toThrow()
    }
  })

  it("has no V1 fields on the flat message type", () => {
    //#given the flat SessionMessage type
    type HasInfo = "info" extends keyof SessionMessage ? true : false
    type HasParts = "parts" extends keyof SessionMessage ? true : false

    //#then neither V1 wrapper key exists — asserted at compile time
    const noInfo: HasInfo = false
    const noParts: HasParts = false

    expect(noInfo).toBe(false)
    expect(noParts).toBe(false)
  })

  it("keeps the flat type assignable from a V2-shaped message", () => {
    //#given a V2 flat message, including a tool part that textOf must ignore
    const textPart: ContentPart = { type: "text", text: "hello" }
    const toolPart: ContentPart = { type: "tool", text: "ignored" }
    const message: SessionMessage = {
      id: "msg_1",
      type: "assistant",
      time: { created: 1_700_000_000 },
      content: [textPart, toolPart],
      finish: "stop",
      agent: "morpheus",
      model: { providerID: "p", modelID: "m" },
    }
    const role: SessionRole = "assistant"

    //#then accessors read the flat fields directly
    expect(sessionMessage.idOf(message)).toBe("msg_1")
    expect(sessionMessage.roleOf(message)).toBe(role)
    expect(sessionMessage.textOf(message)).toBe("hello")
    expect(sessionMessage.finishOf(message)).toBe("stop")
    expect(sessionMessage.timeOf(message)).toBe(1_700_000_000)
    expect(sessionMessage.isAssistant(message)).toBe(true)
    expect(sessionMessage.contentOf(message)).toEqual([textPart, toolPart])
  })
})
