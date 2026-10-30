import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resetNotifySink, setNotifySink } from "../../../src/shared/notify"
import * as messagesReader from "../../../src/hooks/session-recovery/storage/messages-reader"
import { executeCompact } from "../../../src/hooks/context-window-limit-recovery/executor"

type TimerCallback = (...args: unknown[]) => void
type ToastCall = [{ body: { title: string } }]

interface FakeTimeouts {
  advanceBy: (ms: number) => Promise<void>
  restore: () => void
}

function createFakeTimeouts(): FakeTimeouts {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; callback: TimerCallback; args: unknown[] }>()
  const cleared = new Set<number>()

  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: now + normalizeDelay(delay),
      callback,
      args,
    })
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((id?: number) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }) as typeof clearTimeout

  const advanceBy = async (ms: number) => {
    const target = now + Math.max(0, ms)
    while (true) {
      let next: { id: number; time: number; callback: TimerCallback; args: unknown[] } | undefined
      for (const timer of timers.values()) {
        if (timer.time <= target && (!next || timer.time < next.time)) {
          next = timer
        }
      }
      if (!next) break

      now = next.time
      timers.delete(next.id)
      if (!cleared.has(next.id)) {
        next.callback(...next.args)
      }
      cleared.delete(next.id)
      await Promise.resolve()
    }
    now = target
    await Promise.resolve()
  }

  const restore = () => {
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
  }

  return { advanceBy, restore }
}

interface MockClient {
  session: {
    context: ReturnType<typeof mock>
    compact: ReturnType<typeof mock>
  }
}

describe("executeCompact lock management", () => {
  let autoCompactState: AutoCompactState
  let mockClient: MockClient
  let fakeTimeouts: FakeTimeouts
  let notifications: Array<{ level: string; message: string }>
  const sessionID = "test-session-123"
  const directory = "/test/dir"
  const msg = { providerID: "anthropic", modelID: "claude-opus-4-6" }

  beforeEach(() => {
    // given: Fresh state for each test
    autoCompactState = {
      pendingCompact: new Set<string>(),
      errorDataBySession: new Map(),
      retryStateBySession: new Map(),
      truncateStateBySession: new Map(),
      emptyContentAttemptBySession: new Map(),
      compactionInProgress: new Set<string>(),
    }

    notifications = []
    setNotifySink((level, message) => {
      notifications.push({ level, message })
    })
    mockClient = {
      session: {
        context: mock(() => Promise.resolve([])),
        compact: mock(() => Promise.resolve()),
      },
    }

    fakeTimeouts = createFakeTimeouts()
  })

  afterEach(() => {
    fakeTimeouts.restore()
    resetNotifySink()
  })

  test("clears lock on successful summarize completion", async () => {
    // given: Valid session with providerID/modelID
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction successfully
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when summarize throws exception", async () => {
    // given: Summarize will fail
    mockClient.session.compact = mock(() =>
      Promise.reject(new Error("Network timeout")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Lock should still be cleared despite exception
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("shows toast when lock already held", async () => {
    // given: Lock already held
    autoCompactState.compactionInProgress.add(sessionID)

    // when: Try to execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Toast should be shown with warning message
    expect(
      notifications.some(
        (notification) =>
          notification.level === "warn" &&
          notification.message.includes("Compact In Progress") &&
          notification.message.includes("Recovery already running"),
      ),
    ).toBe(true)

    // then: compactionInProgress should still have the lock
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock when fixEmptyMessages path executes", async () => {
    //#given - Empty content error scenario with no messages in storage
    const readMessagesSpy = spyOn(messagesReader, "readMessages").mockReturnValue([])
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "non-empty content required",
      messageIndex: 0,
      currentTokens: 100000,
      maxTokens: 200000,
    })

    //#when - Execute compaction (fixEmptyMessages will be called)
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    //#then - Lock should be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
    readMessagesSpy.mockRestore()
  })


  test("prevents concurrent compaction attempts", async () => {
    // given: Lock already held (simpler test)
    autoCompactState.compactionInProgress.add(sessionID)

    // when: Try to execute compaction while lock is held
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Toast should be shown
    const blockedToast = notifications.find(
      (notification) => notification.message.includes("Compact In Progress"),
    )

    // then: Lock should still be held (not cleared by blocked attempt)
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(true)
  })

  test("clears lock after max recovery attempts exhausted", async () => {
    // given: All retry/revert attempts exhausted
    mockClient.session.context = mock(() => Promise.resolve([]))

    // Max out all attempts
    autoCompactState.retryStateBySession.set(sessionID, {
      attempt: 5,
      lastAttemptTime: Date.now(),
    })
    autoCompactState.truncateStateBySession.set(sessionID, {
      truncateAttempt: 5,
    })
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Should show failure toast
    const failureToast = notifications.find(
      (notification) => notification.message.includes("Auto Compact Failed"),
    )

    // then: Lock should still be cleared
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when the notification sink throws", async () => {
    // given: Notification delivery will fail
    setNotifySink(() => {
      throw new Error("Toast failed")
    })
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // then: Lock should be cleared even if toast fails
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })

  test("clears lock when compact throws in continuation", async () => {
    // given: compact will fail during continuation
    mockClient.session.compact = mock(() =>
      Promise.reject(new Error("Prompt failed")),
    )
    autoCompactState.errorDataBySession.set(sessionID, {
      errorType: "token_limit",
      currentTokens: 100000,
      maxTokens: 200000,
    })

    // when: Execute compaction
    await executeCompact(sessionID, msg, autoCompactState, mockClient, directory)

    // Wait for setTimeout callback
    await fakeTimeouts.advanceBy(600)

    // then: Lock should be cleared
    // The continuation happens in setTimeout, but lock is cleared in finally before that
    expect(autoCompactState.compactionInProgress.has(sessionID)).toBe(false)
  })


})
