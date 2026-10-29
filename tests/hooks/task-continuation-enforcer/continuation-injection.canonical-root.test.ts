import { describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { injectContinuation } from "../../../src/hooks/task-continuation-enforcer/continuation-injection"
import { createSessionStateStore } from "../../../src/hooks/task-continuation-enforcer/session-state"

function writeValidTask(dir: string, id: string, status = "pending", threadID?: string): void {
  const task: Record<string, unknown> = { id, subject: `task ${id}`, description: "d", status, blocks: [], blockedBy: [] }
  if (threadID) task.threadID = threadID
  mkdirSync(join(dir, ".matrixx", "tasks"), { recursive: true })
  writeFileSync(join(dir, ".matrixx", "tasks", `${id}.json`), JSON.stringify(task))
}

function makeCanonicalRootCtx(worktree: string, directory: string): {
  ctx: PluginInput
  promptAsync: ReturnType<typeof mock>
} {
  const promptAsync = mock(async () => ({} as never))
  const ctx = {
    worktree,
    directory,
    client: {
      tui: { showToast: mock(async () => ({} as never)) },
      session: {
        messages: async () => ({ data: [] } as unknown as never) as never,
        promptAsync,
      },
    },
  } as unknown as PluginInput
  return { ctx, promptAsync }
}

const resolvedInfo = {
  agent: "morpheus",
  model: { providerID: "p", modelID: "m" },
  tools: { edit: true },
}

const unionConfig = { morpheus: { tasks: { session_scoped: false } } }

function promptText(promptAsync: ReturnType<typeof mock>): string {
  const arg = promptAsync.mock.calls[0][0] as { body: { parts: Array<{ text: string }> } }
  return arg.body.parts[0].text
}

describe("continuation-injection canonical root", () => {
  test("injects when the pending task lives under the canonical root only", async () => {
    //#given
    const worktree = mkdtempSync(join(tmpdir(), "task-inject-canon-"))
    const directory = mkdtempSync(join(tmpdir(), "task-inject-sess-"))
    writeValidTask(worktree, "T-canon", "pending", "ses-inject-canon")
    const { ctx, promptAsync } = makeCanonicalRootCtx(worktree, directory)
    const store = createSessionStateStore()
    //#when
    await injectContinuation({ ctx, sessionID: "ses-inject-canon", sessionStateStore: store, resolvedInfo, config: unionConfig })
    //#then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    store.shutdown()
    rmSync(worktree, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  })

  test("session directory never supplies the task set when the canonical root owns state", async () => {
    //#given
    const worktree = mkdtempSync(join(tmpdir(), "task-inject-canon-"))
    const directory = mkdtempSync(join(tmpdir(), "task-inject-sess-"))
    writeValidTask(worktree, "T-canon", "pending", "ses-exclusive")
    writeValidTask(directory, "T-session", "pending", "ses-exclusive")
    const { ctx, promptAsync } = makeCanonicalRootCtx(worktree, directory)
    const store = createSessionStateStore()
    //#when
    await injectContinuation({ ctx, sessionID: "ses-exclusive", sessionStateStore: store, resolvedInfo, config: unionConfig })
    //#then
    const text = promptText(promptAsync)
    expect(text).toContain("T-canon")
    expect(text).toContain("[Status: 0/1 completed, 1 remaining]")
    expect(text).not.toContain("T-session")
    store.shutdown()
    rmSync(worktree, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  })

  test("does not inject when only the session directory holds tasks", async () => {
    //#given
    const worktree = mkdtempSync(join(tmpdir(), "task-inject-canon-"))
    const directory = mkdtempSync(join(tmpdir(), "task-inject-sess-"))
    writeValidTask(worktree, "T-done", "completed", "ses-only-session")
    writeValidTask(directory, "T-fresh", "pending", "ses-only-session")
    const { ctx, promptAsync } = makeCanonicalRootCtx(worktree, directory)
    const store = createSessionStateStore()
    //#when
    await injectContinuation({ ctx, sessionID: "ses-only-session", sessionStateStore: store, resolvedInfo, config: unionConfig })
    //#then
    expect(promptAsync).not.toHaveBeenCalled()
    store.shutdown()
    rmSync(worktree, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  })
})
