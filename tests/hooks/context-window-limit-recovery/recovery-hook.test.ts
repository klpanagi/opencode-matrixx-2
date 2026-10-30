import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// Shared log file (mirrors src/shared/logger.ts): the mock.module below is
// process-wide, so it forwards to the real file instead of swallowing.
const LOG_FILE = join(tmpdir(), "matrixx.log")

const executeCompactMock = mock(async () => {})
const getLastAssistantMock = mock(async () => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-5",
}))
const parseAnthropicTokenLimitErrorMock = mock(() => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-5",
}))

mock.module("../../../src/hooks/context-window-limit-recovery/executor", () => ({
  executeCompact: executeCompactMock,
  getLastAssistant: getLastAssistantMock,
}))

mock.module("../../../src/hooks/context-window-limit-recovery/parser", () => ({
  parseAnthropicTokenLimitError: parseAnthropicTokenLimitErrorMock,
  parseTokenLimitError: parseAnthropicTokenLimitErrorMock,
}))

mock.module("../../../src/shared/logger", () => ({
  // Transparent from birth: forward to the real log file (same format as
  // src/shared/logger.ts) instead of swallowing, so later suites that assert
  // on /tmp/matrixx.log keep working. Never references the mocked module.
  log: (message: string, data?: unknown) => {
    try {
      appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message} ${data !== undefined ? JSON.stringify(data) : ""}\n`)
    } catch {}
  },
}))

afterAll(() => {
  // The logger mock above is transparent from birth (forwards to the real
  // file), so later suites are unaffected. mock.restore() clears call history.
  mock.restore()
})

function createMockContext(): MatrixxContext {
  return {
    session: { context: async () => [] },
    directory: "/tmp",
  } as MatrixxContext
}

function setupDelayedTimeoutMocks(): {
  restore: () => void
  getClearTimeoutCalls: () => Array<ReturnType<typeof setTimeout>>
} {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const clearTimeoutCalls: Array<ReturnType<typeof setTimeout>> = []
  let timeoutCounter = 0

  globalThis.setTimeout = ((_: () => void, _delay?: number) => {
    timeoutCounter += 1
    return timeoutCounter as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timeoutID: ReturnType<typeof setTimeout>) => {
    clearTimeoutCalls.push(timeoutID)
  }) as typeof clearTimeout

  return {
    restore: () => {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
    getClearTimeoutCalls: () => clearTimeoutCalls,
  }
}

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  beforeEach(() => {
    executeCompactMock.mockClear()
    getLastAssistantMock.mockClear()
    parseAnthropicTokenLimitErrorMock.mockClear()
  })

  test("cancels pending timer when session.idle handles compaction first", async () => {
    //#given
    const { restore, getClearTimeoutCalls } = setupDelayedTimeoutMocks()
    const { createAnthropicContextWindowLimitRecoveryHook } = await import("../../../src/hooks/context-window-limit-recovery/recovery-hook")
    const hook = createAnthropicContextWindowLimitRecoveryHook(createMockContext())

    try {
      //#when
      await hook.event({
        type: "session.error",
        data: { sessionID: "session-race", error: "prompt is too long" },
      })

      await hook.event({
        type: "session.idle",
        data: { sessionID: "session-race" },
      })

      //#then
      expect(getClearTimeoutCalls()).toEqual([1 as ReturnType<typeof setTimeout>])
      expect(executeCompactMock).toHaveBeenCalledTimes(1)
      expect(executeCompactMock.mock.calls[0]?.[0]).toBe("session-race")
    } finally {
      restore()
    }
  })
})
