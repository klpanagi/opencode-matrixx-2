import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as dynamicTruncator from "../../src/shared/compaction/dynamic-truncator"
import { createToolOutputTruncatorHook } from "../../src/hooks/tool-output-truncator"

const LOG_FILE = join(tmpdir(), "matrixx.log")

function logSize(): number {
  try {
    return statSync(LOG_FILE).size
  } catch {
    return 0
  }
}

function readLogSince(offset: number): string {
  const size = logSize()
  if (size <= offset) return ""
  const fd = openSync(LOG_FILE, "r")
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    return buffer.toString("utf-8")
  } finally {
    closeSync(fd)
  }
}

describe("createToolOutputTruncatorHook", () => {
  let hook: ReturnType<typeof createToolOutputTruncatorHook>
  let truncateSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    truncateSpy = spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
      truncate: mock(async (_sessionID: string, output: string, options?: { targetMaxTokens?: number }) => ({
        result: output,
        truncated: false,
        targetMaxTokens: options?.targetMaxTokens,
      })),
      getUsage: mock(async () => null),
      truncateSync: mock(() => ({ result: "", truncated: false })),
    })
    hook = createToolOutputTruncatorHook({} as never)
  })

  afterEach(() => {
    truncateSpy.mockRestore()
  })

  describe("tool.execute.after", () => {
    const createInput = (tool: string) => ({
      tool,
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string) => ({
      title: "Result",
      output: outputText,
      metadata: {},
    })

    describe("#given webfetch tool", () => {
      describe("#when output is processed", () => {
        it("#then should use aggressive truncation limit (10k tokens)", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
            targetMaxTokens: options?.targetMaxTokens,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("webfetch")
          const output = createOutput("large content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "large content",
            { targetMaxTokens: 10_000 }
          )
        })
      })

      describe("#when using WebFetch variant", () => {
        it("#then should also use aggressive truncation limit", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("WebFetch")
          const output = createOutput("large content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "large content",
            { targetMaxTokens: 10_000 }
          )
        })
      })
    })

    describe("#given grep tool", () => {
      describe("#when output is processed", () => {
        it("#then should use default truncation limit (50k tokens)", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("grep")
          const output = createOutput("grep output")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "grep output",
            { targetMaxTokens: 50_000 }
          )
        })
      })
    })

    describe("#given non-truncatable tool", () => {
      describe("#when tool is not in TRUNCATABLE_TOOLS list", () => {
        it("#then should not call truncator", async () => {
          const truncateMock = mock(async () => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("write")
          const output = createOutput("file content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).not.toHaveBeenCalled()
        })
      })
    })

    describe("#given truncate_all_tool_outputs enabled", () => {
      describe("#when any tool output is processed", () => {
        it("#then should truncate non-listed tools too", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never, {
            experimental: { truncate_all_tool_outputs: true },
          })

          const input = createInput("Read")
          const output = createOutput("file content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalled()
        })
      })
    })

    describe("#given the truncator throws", () => {
      describe("#when a truncatable output is processed", () => {
        it("#then warns with the pre-truncation size and leaves the output intact", async () => {
          //#given a truncator that fails and a large output
          const raw = "x".repeat(12_345)
          truncateSpy.mockReturnValue({
            truncate: mock(async () => {
              throw new Error("truncator exploded")
            }),
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)
          const callID = `t15-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const input = { tool: "grep", sessionID: "session-t15", callID }
          const output = createOutput(raw)
          const offset = logSize()

          //#when the post-tool hook runs
          await hook["tool.execute.after"](input, output)

          //#then the output is untouched and one warning records the size and reason
          expect(output.output).toBe(raw)
          const lines = readLogSince(offset).split("\n").filter((line) => line.includes(callID))
          expect(lines).toHaveLength(1)
          expect(lines[0]).toContain("[WARN]")
          expect(lines[0]).toContain(`"outputLength":${raw.length}`)
          expect(lines[0]).toContain("truncator exploded")
        })
      })
    })
  })
})
