/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { writeHandle, readHandles } from "../../../src/features/background-agent/handle-index"

let TMP_DIR = ""

interface PromptCall {
  sessionID: string
  text?: string
  [key: string]: unknown
}

function makeClient() {
  const promptCalls: PromptCall[] = []
  const native = {
    session: {
      get: async () => ({ directory: TMP_DIR }),
      create: async () => ({ id: "sess_new" }),
      prompt: async (args: PromptCall) => {
        promptCalls.push(args)
        return {}
      },
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return { client: native, promptCalls }
}

function makeManager(client: unknown, dir: string, config?: unknown): BackgroundManager {
  return new BackgroundManager({ ...(client as Record<string, unknown>), directory: dir } as never, config as never)
}

function seedCompletedTask(overrides?: Partial<BackgroundTask>): BackgroundTask {
  const task: BackgroundTask = {
    id: "bg_revive01",
    status: "completed",
    sessionID: "sess_revive01",
    parentSessionID: "sess_parent01",
    parentMessageID: "msg_parent01",
    description: "revivable task",
    prompt: "old prompt",
    agent: "oracle",
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:01:00Z"),
    completedAt: new Date(),
    ...overrides,
  }
  writeHandle(TMP_DIR, task)
  return task
}

describe("BackgroundManager.revive", () => {
  beforeEach(() => {
    TMP_DIR = mkdtempSync(join(tmpdir(), "revive-"))
  })

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true })
    } catch { /* best-effort */ }
  })

  test("(a) map-miss revive from a written handle file succeeds", async () => {
    //#given
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed = seedCompletedTask()
    const NEW_PROMPT = "fresh revive prompt"

    //#when
    const revived = await mgr.revive({
      taskId: seed.id,
      prompt: NEW_PROMPT,
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_new01",
    })

    //#then
    expect(revived.status).toBe("running")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe(seed.sessionID)
    expect(promptCalls[0].text).toBe(NEW_PROMPT)
    mgr.shutdown()
  })

  test("(b) pruned-then-revived succeeds without Task not found", async () => {
    //#given
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed = seedCompletedTask({ id: "bg_pruned01", sessionID: "sess_pruned01" })
    const inMemory: BackgroundTask = { ...seed, prompt: "old" }
    mgr["tasks"].set(seed.id, inMemory)
    writeHandle(TMP_DIR, inMemory)
    mgr["tasks"].delete(seed.id)

    //#when
    const revived = await mgr.revive({
      taskId: seed.id,
      prompt: "revive after prune",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_prune01",
    })

    //#then
    expect(revived.status).toBe("running")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("sess_pruned01")
    mgr.shutdown()
  })

  test("(c) fresh manager revives without restoreHandles", async () => {
    //#given
    const { client: clientA } = makeClient()
    const mgrA = makeManager(clientA, TMP_DIR)
    const seed = seedCompletedTask({ id: "bg_fresh01", sessionID: "sess_fresh01" })
    expect(mgrA.getTask(seed.id)).toBeUndefined()
    const { client: clientB, promptCalls } = makeClient()
    const mgrB = makeManager(clientB, TMP_DIR)

    //#when
    expect(mgrB.getTask(seed.id)).toBeUndefined()
    const revived = await mgrB.revive({
      taskId: seed.id,
      prompt: "revive on cold manager",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_fresh01",
    })

    //#then
    expect(revived.status).toBe("running")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("sess_fresh01")
    mgrA.shutdown()
    mgrB.shutdown()
  })

  test("(d) running task revive returns it unchanged", async () => {
    //#given
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const running: BackgroundTask = {
      id: "bg_running01",
      status: "running",
      sessionID: "sess_running01",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_run01",
      description: "running task",
      prompt: "original",
      agent: "oracle",
      startedAt: new Date(),
    }
    mgr["tasks"].set(running.id, running)

    //#when
    const result = await mgr.revive({
      taskId: running.id,
      prompt: "should be ignored",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_run02",
    })

    //#then
    expect(result.status).toBe("running")
    expect(result.prompt).toBe("original")
    expect(promptCalls.length).toBe(0)
    mgr.shutdown()
  })

  test("(e) statusUncertain without force throws, with force proceeds", async () => {
    //#given
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    seedCompletedTask({ id: "bg_uncertain01", sessionID: "sess_uncertain01", status: "statusUncertain" })

    //#when
    let thrown: Error | undefined
    try {
      await mgr.revive({
        taskId: "bg_uncertain01",
        prompt: "retry",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_unc01",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("unknown liveness")

    //#when
    const revived = await mgr.revive({
      taskId: "bg_uncertain01",
      prompt: "forced retry",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_unc02",
      force: true,
    })

    //#then
    expect(revived.status).toBe("running")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].text).toBe("forced retry")
    mgr.shutdown()
  })

  test("(f) handle with no sessionID throws no-session guidance", async () => {
    //#given
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed: BackgroundTask = {
      id: "bg_nosess01",
      status: "completed",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_nosess01",
      description: "no session task",
      prompt: "old",
      agent: "oracle",
      completedAt: new Date(),
    }
    writeHandle(TMP_DIR, seed)

    //#when
    let thrown: Error | undefined
    try {
      await mgr.revive({
        taskId: seed.id,
        prompt: "retry",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_nosess02",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("has no session")
    mgr.shutdown()
  })

  test("listRevivable merges memory and disk, dedupes, scopes, sorts", async () => {
    //#given
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const older = seedCompletedTask({
      id: "bg_list_old",
      sessionID: "sess_list_old",
      description: "older",
      completedAt: new Date("2026-01-01T00:00:00Z"),
    })
    const newer = seedCompletedTask({
      id: "bg_list_new",
      sessionID: "sess_list_new",
      description: "newer",
      parentSessionID: "sess_other_parent",
      completedAt: new Date("2026-06-01T00:00:00Z"),
    })
    void older
    void newer

    //#when
    const all = mgr.listRevivable()
    const scoped = mgr.listRevivable("sess_other_parent")

    //#then
    const ids = all.map((e) => e.taskId)
    expect(ids).toContain("bg_list_old")
    expect(ids).toContain("bg_list_new")
    expect(all.findIndex((e) => e.taskId === "bg_list_new")).toBeLessThan(
      all.findIndex((e) => e.taskId === "bg_list_old"),
    )
    expect(scoped.map((e) => e.taskId)).toEqual(["bg_list_new"])
    mgr.shutdown()
  })

  test("(g) unregistered native session_id fails with bg_-only guidance, not generic not-found", async () => {
    //#given a manager with no tasks or handles
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)

    //#when reviving a native ses_ id that has no bg_ handle
    let thrown: Error | undefined
    try {
      await mgr.revive({
        sessionId: "ses_native01",
        prompt: "new instructions",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_nat01",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then the error is the bg_-only guidance, not the generic expired message
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("bg_-only")
    expect(thrown!.message).not.toContain("Task not found for revive")
    mgr.shutdown()
  })

  test("(h) ses_-shaped taskId fails with bg_-only guidance", async () => {
    //#given a manager with no tasks or handles
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)

    //#when reviving with a native ses_ id passed as taskId
    let thrown: Error | undefined
    try {
      await mgr.revive({
        taskId: "ses_native02",
        prompt: "new instructions",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_nat02",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then the error is the bg_-only guidance
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("bg_-only")
    mgr.shutdown()
  })

  test("(i) unknown non-ses_ taskId keeps the legacy not-found error", async () => {
    //#given a manager with no tasks or handles
    const { client } = makeClient()
    const mgr = makeManager(client, TMP_DIR)

    //#when reviving an unknown bg_ id
    let thrown: Error | undefined
    try {
      await mgr.revive({
        taskId: "bg_missing01",
        prompt: "new instructions",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_miss01",
      })
    } catch (error) {
      thrown = error as Error
    }

    //#then the legacy generic message is preserved
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain("Task not found for revive")
    expect(thrown!.message).not.toContain("bg_-only")
    mgr.shutdown()
  })

  test("(j) persisted handle still wins over ses_ shape: revive by session_id succeeds", async () => {
    //#given a completed handle on disk whose session is a native ses_ id
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    seedCompletedTask({ id: "bg_sesshandle01", sessionID: "ses_handled01" })

    //#when reviving by that session id
    const revived = await mgr.revive({
      sessionId: "ses_handled01",
      prompt: "resume handled session",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_h01",
    })

    //#then the handle is revived, not rejected as native-only
    expect(revived.status).toBe("running")
    expect(revived.id).toBe("bg_sesshandle01")
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe("ses_handled01")
    mgr.shutdown()
  })
})
