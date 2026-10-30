import { describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"
import { handleSessionIdle } from "../../../src/hooks/task-continuation-enforcer/idle-event"
import { createSessionStateStore } from "../../../src/hooks/task-continuation-enforcer/session-state"
import { setNotifySink } from "../../../src/shared/notify"

function writeValidTask(dir: string, id: string, status = "pending", threadID?: string): void {
  const task: Record<string, unknown> = { id, subject: `task ${id}`, description: "d", status, blocks: [], blockedBy: [] }
  if (threadID) task.threadID = threadID
  mkdirSync(join(dir, ".matrixx", "tasks"), { recursive: true })
  writeFileSync(join(dir, ".matrixx", "tasks", `${id}.json`), JSON.stringify(task))
}

function makeCanonicalRootCtx(worktree: string, directory: string): {
  ctx: PluginInput
  toastMock: ReturnType<typeof mock>
} {
  const toastMock = mock(async () => ({} as never))
  setNotifySink(toastMock)
  const ctx = {
    worktree,
    directory,
    session: {
      context: async () => [],
    },
  } as unknown as PluginInput
  return { ctx, toastMock }
}

describe("idle-event canonical root", () => {
  test("starts countdown when tasks live under the canonical root only", async () => {
    //#given
    const root = mkdtempSync(join(tmpdir(), "task-canon-root-"))
    const sessionDir = join(root, "packages", "nested")
    mkdirSync(sessionDir, { recursive: true })
    writeValidTask(root, "T-c", "pending", "s-canon")
    const { ctx, toastMock } = makeCanonicalRootCtx(root, sessionDir)
    const store = createSessionStateStore()
    //#when
    await handleSessionIdle({
      ctx,
      sessionID: "s-canon",
      sessionStateStore: store,
      skipAgents: [],
      config: { morpheus: { tasks: { session_scoped: false } } },
    })
    //#then
    expect(toastMock).toHaveBeenCalledTimes(1)
    const body = toastMock.mock.calls[0]?.[1] as string | undefined
    expect(body).toContain("(1 tasks remaining)")
    expect(store.getState("s-canon").countdownTimer).toBeDefined()
    store.shutdown()
    rmSync(root, { recursive: true, force: true })
  })

  test("ignores tasks under the session directory when the canonical root owns state", async () => {
    //#given
    const root = mkdtempSync(join(tmpdir(), "task-canon-root-"))
    const sessionDir = join(root, "packages", "nested")
    mkdirSync(sessionDir, { recursive: true })
    writeValidTask(root, "T-canon", "pending", "s-both")
    writeValidTask(sessionDir, "T-session", "pending", "s-both")
    const { ctx, toastMock } = makeCanonicalRootCtx(root, sessionDir)
    const store = createSessionStateStore()
    //#when
    await handleSessionIdle({
      ctx,
      sessionID: "s-both",
      sessionStateStore: store,
      skipAgents: [],
      config: { morpheus: { tasks: { session_scoped: false } } },
    })
    //#then
    expect(toastMock).toHaveBeenCalledTimes(1)
    const body = toastMock.mock.calls[0]?.[1] as string | undefined
    expect(body).toContain("(1 tasks remaining)")
    expect(body).not.toContain("(2 tasks remaining)")
    store.shutdown()
    rmSync(root, { recursive: true, force: true })
  })

  test("does not start a countdown when only the session directory holds tasks", async () => {
    //#given
    const root = mkdtempSync(join(tmpdir(), "task-canon-root-"))
    const sessionDir = join(root, "packages", "nested")
    mkdirSync(sessionDir, { recursive: true })
    writeValidTask(root, "T-done", "completed", "s-miss")
    writeValidTask(sessionDir, "T-fresh", "pending", "s-miss")
    const { ctx, toastMock } = makeCanonicalRootCtx(root, sessionDir)
    const store = createSessionStateStore()
    //#when
    await handleSessionIdle({
      ctx,
      sessionID: "s-miss",
      sessionStateStore: store,
      skipAgents: [],
      config: { morpheus: { tasks: { session_scoped: false } } },
    })
    //#then
    expect(toastMock).not.toHaveBeenCalled()
    expect(store.getState("s-miss").countdownTimer).toBeUndefined()
    store.shutdown()
    rmSync(root, { recursive: true, force: true })
  })

  test("falls back to the session directory only when the canonical root has no .matrixx", async () => {
    //#given
    const root = mkdtempSync(join(tmpdir(), "task-canon-root-"))
    const sessionDir = join(root, "packages", "nested")
    mkdirSync(sessionDir, { recursive: true })
    writeValidTask(sessionDir, "T-legacy", "pending", "s-legacy")
    const { ctx, toastMock } = makeCanonicalRootCtx(root, sessionDir)
    const store = createSessionStateStore()
    //#when
    await handleSessionIdle({
      ctx,
      sessionID: "s-legacy",
      sessionStateStore: store,
      skipAgents: [],
      config: { morpheus: { tasks: { session_scoped: false } } },
    })
    //#then
    expect(toastMock).toHaveBeenCalledTimes(1)
    const body = toastMock.mock.calls[0]?.[1] as string | undefined
    expect(body).toContain("(1 tasks remaining)")
    store.shutdown()
    rmSync(root, { recursive: true, force: true })
  })
})
