import { describe, expect, test } from "bun:test"
import { CORPUS_NAMES, loadCorpus } from "./loader"

// Canary for the Phase 2 corpora: if a fixture is corrupted or truncated the
// failure must be loud here rather than as a mysterious golden mismatch.

type AnyRecord = Record<string, unknown>

function asRecords(messages: unknown[]): AnyRecord[] {
  return messages.filter((message): message is AnyRecord => typeof message === "object" && message !== null)
}

function roleOf(message: AnyRecord): string | undefined {
  const info = message.info as AnyRecord | undefined
  const role = info?.role
  return typeof role === "string" ? role : undefined
}

function typeOf(message: AnyRecord): string | undefined {
  return typeof message.type === "string" ? message.type : undefined
}

describe("message corpora", () => {
  test("every corpus parses and carries at least one user and one assistant", () => {
    //#given the three checked-in corpora
    //#when each is loaded through the loader
    for (const name of CORPUS_NAMES) {
      const messages = asRecords(loadCorpus(name))
      //#then each has enough elements and both roles the consumers care about
      expect(messages.length).toBeGreaterThanOrEqual(3)
      const roles = messages.map((message) => roleOf(message) ?? typeOf(message))
      expect(roles).toContain("user")
      expect(roles).toContain("assistant")
    }
  })

  test("v1-shaped records the contract consumers read today", () => {
    //#given the v1 corpus
    const messages = asRecords(loadCorpus("v1-shaped"))
    //#when inspected
    //#then every element is a { info, parts } pair and none carries a flat type
    for (const message of messages) {
      expect(typeof message.info).toBe("object")
      expect(Array.isArray(message.parts)).toBe(true)
      expect(message.type).toBeUndefined()
    }
  })

  test("v2-flat records the flat union the host actually returns", () => {
    //#given the v2 corpus
    const messages = asRecords(loadCorpus("v2-flat"))
    //#when inspected
    //#then every element is flat: a string type, no info wrapper, a created timestamp
    for (const message of messages) {
      expect(typeof message.type).toBe("string")
      expect(message.info).toBeUndefined()
      expect(message.parts).toBeUndefined()
      const time = message.time as AnyRecord | undefined
      expect(typeof time?.created).toBe("number")
    }
    const assistant = messages.find((message) => typeOf(message) === "assistant")
    //#then the assistant content lives in a content array of typed parts
    expect(Array.isArray(assistant?.content)).toBe(true)
  })

  test("v2-assistant-tool captures a settled tool part and a stop finish", () => {
    //#given the tool corpus
    const messages = asRecords(loadCorpus("v2-assistant-tool"))
    const assistant = messages.find((message) => typeOf(message) === "assistant")
    //#when inspected
    const content = (assistant?.content ?? []) as AnyRecord[]
    const toolPart = content.find((part) => part.type === "tool")
    //#then the tool part is settled and the assistant reports a normal finish
    expect(toolPart?.name).toBeDefined()
    expect((toolPart?.state as AnyRecord | undefined)?.status).toBe("completed")
    expect(assistant?.finish).toBe("stop")
  })

  test("the loader rejects unknown corpus names", () => {
    //#given an unknown corpus name
    //#when loaded
    //#then it fails instead of returning an empty array
    expect(() => loadCorpus("nope" as never)).toThrow()
  })
})
