const { describe, test, expect, mock } = require("bun:test")

const { tmpdir } = require("node:os")
const { BackgroundManager } = require("../../../src/features/background-agent/manager")
const { executeBackgroundContinuation } = require("../../../src/tools/delegate-task/background-continuation")
const { executeSyncContinuation } = require("../../../src/tools/delegate-task/sync-continuation")
const { setSubagentParent } = require("../../../src/features/session-state/parent-registry")

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "bg_task_001",
    sessionID: "ses_task_001",
    parentSessionID: "parent-session",
    parentMessageID: "msg-parent",
    description: "continuing task",
    prompt: "original prompt",
    agent: "oracle",
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  }
}

function buildBackgroundContext(parentSessionID = "parent-session") {
  return {
    sessionID: parentSessionID,
    messageID: "msg-parent",
    agent: "morpheus",
    abort: new AbortController().signal,
    metadata: mock(() => Promise.resolve()),
    callID: "call-bg",
  }
}

function buildContinuationArgs(sessionID: string) {
  return {
    session_id: sessionID,
    prompt: "continue working",
    description: "resume task",
    load_skills: [],
    run_in_background: true,
  }
}

function buildSyncClient() {
  return {
    session: {
      prompt: mock(async () => ({})),
      messages: async () => ({ data: [] }),
    },
  }
}

function buildSyncDeps(registeredParent?: string) {
  return {
    pollSyncSession: mock(async () => null),
    fetchSyncResult: mock(async () => ({ ok: true as const, textContent: "Result" })),
    getParentSessionID: mock(() => registeredParent),
  }
}

function buildSyncContext(sessionID = "parent-session") {
  return {
    sessionID,
    messageID: "msg-parent",
    agent: "morpheus",
    abort: new AbortController().signal,
    metadata: mock(() => Promise.resolve()),
    callID: "call-sync",
  }
}

function buildRealManager() {
  const native = {
    session: {
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager(native, undefined, { pluginConfig: { directory: tmpdir() } })
}

describe("continuation routing - background", () => {
  test("rejects a raw ses_ session id without resuming", async () => {
    //#given - a caller passing a raw session id to a background continuation
    const resume = mock(async () => buildTask())
    const manager = { getTask: mock(() => undefined), resume }
    const args = buildContinuationArgs("ses_raw_123")

    //#when
    const result = await executeBackgroundContinuation(
      args,
      buildBackgroundContext(),
      { manager },
      { sessionID: "parent-session", messageID: "msg-parent" },
    )

    //#then - structured error tells the caller to use a bg_ task id
    expect(result).toContain("background task id")
    expect(result).toContain("bg_")
    expect(resume).not.toHaveBeenCalled()
  })

  test("rejects a foreign background task and leaves it untouched", async () => {
    //#given - a task owned by a different parent session
    const foreignTask = buildTask({ id: "bg_foreign", sessionID: "ses_foreign_1", parentSessionID: "other-parent" })
    const resume = mock(async () => foreignTask)
    const manager = { getTask: mock(() => foreignTask), resume }
    const args = buildContinuationArgs("bg_foreign")

    //#when
    const result = await executeBackgroundContinuation(
      args,
      buildBackgroundContext(),
      { manager },
      { sessionID: "parent-session", messageID: "msg-parent" },
    )

    //#then
    expect(result).toContain("does not belong to parent session")
    expect(resume).not.toHaveBeenCalled()
    expect(foreignTask.status).toBe("completed")
    expect(foreignTask.parentSessionID).toBe("other-parent")
  })

  test("resumes an owned task with its real session id", async () => {
    //#given - a task owned by the calling parent
    const ownedTask = buildTask({ id: "bg_own", sessionID: "ses_own_1" })
    const resume = mock(async () => ({ ...ownedTask, status: "running" }))
    const manager = { getTask: mock(() => ownedTask), resume }
    const args = buildContinuationArgs("bg_own")
    const parentContext = { sessionID: "parent-session", messageID: "msg-parent" }

    //#when
    const result = await executeBackgroundContinuation(
      args,
      buildBackgroundContext(),
      { manager },
      parentContext,
    )

    //#then - resume receives the task's session, not the bg id
    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume.mock.calls[0][0]).toMatchObject({
      sessionId: "ses_own_1",
      parentSessionID: "parent-session",
      prompt: "continue working",
    })
    expect(result).toContain("Background task continued.")
  })
})

describe("continuation routing - resumeTask ownership", () => {
  test("throws before mutating when the parent session does not own the task", async () => {
    //#given - a real manager holding a task owned by owner-parent
    const manager = buildRealManager()
    const task = buildTask({ id: "bg_owned", sessionID: "ses_owned_1", parentSessionID: "owner-parent" })
    manager.tasks.set(task.id, task)

    //#when / #then
    await expect(
      manager.resume({
        sessionId: "ses_owned_1",
        prompt: "hijack",
        parentSessionID: "intruder",
        parentMessageID: "msg-intruder",
      }),
    ).rejects.toThrow("does not belong to parent session")

    expect(task.status).toBe("completed")
    expect(task.parentSessionID).toBe("owner-parent")
    expect(task.parentMessageID).toBe("msg-parent")
  })
})

describe("continuation routing - sync", () => {
  test("rejects a foreign registered session without prompting", async () => {
    //#given - ses_foreign is registered to a different parent
    const client = buildSyncClient()
    const deps = buildSyncDeps("other-parent")
    const args = { ...buildContinuationArgs("ses_foreign_sync"), run_in_background: false }

    //#when
    const result = await executeSyncContinuation(args, buildSyncContext(), { client }, deps)

    //#then
    expect(result).toContain("not owned by the calling session")
    expect(client.session.prompt).not.toHaveBeenCalled()
    expect(deps.pollSyncSession).not.toHaveBeenCalled()
  })

  test("enforces ownership via the unmocked parent registry by default", async () => {
    //#given - ownership lives in parent-registry, not the mock-heavy state module
    setSubagentParent("ses_registry_sync", "other-parent")
    const client = buildSyncClient()
    const deps = {
      pollSyncSession: mock(async () => null),
      fetchSyncResult: mock(async () => ({ ok: true as const, textContent: "Result" })),
    }
    const args = { ...buildContinuationArgs("ses_registry_sync"), run_in_background: false }

    //#when
    const result = await executeSyncContinuation(args, buildSyncContext(), { client }, deps)

    //#then
    expect(result).toContain("not owned by the calling session")
    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("prompts an owned registered session (success path unchanged)", async () => {
    //#given - ses_own_sync is registered to the calling parent
    const client = buildSyncClient()
    const deps = buildSyncDeps("parent-session")
    const args = { ...buildContinuationArgs("ses_own_sync"), run_in_background: false }

    //#when
    const result = await executeSyncContinuation(args, buildSyncContext(), { client }, deps)

    //#then
    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    expect(client.session.prompt.mock.calls[0][0]).toMatchObject({ sessionID: "ses_own_sync" })
    expect(result).toContain("Task continued and completed")
  })
})
