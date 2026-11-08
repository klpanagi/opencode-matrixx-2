/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"

import { collectTelemetry } from "../../../src/features/agent-effort/collect"
import { DEFAULT_MAX_MESSAGES } from "../../../src/features/agent-effort/constants"

function assistantMessage(tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}) {
  return {
    type: "assistant",
    info: { role: "assistant", tokens },
    time: { created: 1000 },
  }
}

describe("collectTelemetry", () => {
  describe("happy path", () => {
    it("sums tokens and counts steps, tools, unique tools and retries", () => {
      //#given
      const messages = [
        {
          type: "assistant",
          info: {
            role: "assistant",
            tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 2, write: 3 } },
          },
          content: [
            { type: "tool", tool: "read" },
            { type: "text", text: "hi" },
          ],
          time: { created: 1000 },
        },
        {
          type: "assistant",
          tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 20, write: 30 } },
          content: [
            { type: "tool-invocation", name: "read" },
            { type: "tool_use", toolName: "bash" },
            { type: "tool-call", tool: "grep" },
          ],
          error: "tool failed",
          time: { created: 3000 },
        },
        {
          type: "user",
          text: "hello",
          time: { created: 4000 },
        },
      ]

      //#when
      const result = collectTelemetry(messages)

      //#then
      expect(result.coverage).toBe("full")
      expect(result.missing).toEqual([])
      expect(result.telemetry.input).toBe(110)
      expect(result.telemetry.output).toBe(220)
      expect(result.telemetry.reasoning).toBe(55)
      expect(result.telemetry.cacheRead).toBe(22)
      expect(result.telemetry.cacheWrite).toBe(33)
      expect(result.telemetry.steps).toBe(2)
      expect(result.telemetry.toolCalls).toBe(4)
      expect(result.telemetry.uniqueTools).toBe(3)
      expect(result.telemetry.retries).toBe(1)
      expect(result.telemetry.durationMs).toBe(3000)
    })
  })

  describe("missing token blocks", () => {
    it("marks coverage partial and reports tokens when an assistant message lacks tokens", () => {
      //#given
      const messages = [assistantMessage({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } }), { type: "assistant", info: { role: "assistant" } }]

      //#when
      const result = collectTelemetry(messages)

      //#then
      expect(result.coverage).toBe("partial")
      expect(result.missing).toContain("tokens")
      expect(result.telemetry.input).toBe(1)
      expect(result.telemetry.output).toBe(2)
    })
  })

  describe("message bounding", () => {
    it("keeps only the last DEFAULT_MAX_MESSAGES messages and flags truncation", () => {
      //#given
      const messages = Array.from({ length: DEFAULT_MAX_MESSAGES + 5 }, (_, index) => ({
        type: "assistant",
        info: {
          role: "assistant",
          tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        time: { created: index },
      }))

      //#when
      const result = collectTelemetry(messages)

      //#then
      expect(result.missing).toContain("truncated:messages")
      expect(result.coverage).toBe("partial")
      expect(result.telemetry.steps).toBe(DEFAULT_MAX_MESSAGES)
      expect(result.telemetry.input).toBe(DEFAULT_MAX_MESSAGES)
    })
  })

  describe("byte bounding", () => {
    it("stops accumulating once the byte cap is hit and flags truncation", () => {
      //#given
      const messages = Array.from({ length: 10 }, () => ({
        type: "user",
        text: "x".repeat(300_000),
        content: [{ type: "tool", tool: "read" }],
      }))

      //#when
      const result = collectTelemetry(messages)

      //#then
      expect(result.missing).toContain("truncated:bytes")
      expect(result.coverage).toBe("partial")
      expect(result.telemetry.toolCalls).toBeGreaterThan(0)
      expect(result.telemetry.toolCalls).toBeLessThan(messages.length)
    })
  })

  describe("empty input", () => {
    it("returns zeros with full coverage", () => {
      //#given
      const messages: unknown[] = []

      //#when
      const result = collectTelemetry(messages)

      //#then
      expect(result.coverage).toBe("full")
      expect(result.missing).toEqual([])
      expect(result.telemetry).toEqual({
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        steps: 0,
        toolCalls: 0,
        uniqueTools: 0,
        retries: 0,
        durationMs: 0,
      })
    })
  })

  describe("duration", () => {
    it("prefers the supplied finite timing duration", () => {
      //#given
      const messages = [assistantMessage({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })]

      //#when
      const result = collectTelemetry(messages, { durationMs: 1234 })

      //#then
      expect(result.telemetry.durationMs).toBe(1234)
    })

    it("ignores negative supplied duration and never emits negative numbers", () => {
      //#given
      const messages = [
        { type: "user", time: { created: 5000 } },
        { type: "user", time: { created: 1000 } },
      ]

      //#when
      const result = collectTelemetry(messages, { durationMs: -5 })

      //#then
      expect(result.telemetry.durationMs).toBe(0)
      for (const value of Object.values(result.telemetry)) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
