/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MatrixxContext } from "../../../src/plugin/tool/context"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { WallclockSupervisor } from "../../../src/features/background-agent/wallclock"
import type { BackgroundTask } from "../../../src/features/background-agent/types"

function createManager(
  directory: string,
  session: Record<string, unknown>,
): BackgroundManager {
  const native = {
    session: {
      create: async () => ({ id: `ses_${Math.random().toString(36).slice(2, 8)}` }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      ...session,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return new BackgroundManager({ ...native, directory } as unknown as MatrixxContext)
}

function seedTask(manager: BackgroundManager, overrides: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  const task: BackgroundTask = {
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "settle task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
  ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
  return task
}

describe("B1 settled-guard: no double terminal writes", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mgr-settle-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("cancel-then-prompt-reject keeps cancelled (not interrupt)", async () => {
    //#given
    let rejectPrompt!: (err: Error) => void
    const promptGate = new Promise<never>((_, reject) => {
      rejectPrompt = reject
    })
    const manager = createManager(dir, { prompt: () => promptGate })
    const task = await manager.launch({
      description: "settle work",
      prompt: "do work",
      agent: "task",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    expect(task.status).toBe("running")

    //#when
    await manager.cancelTask(task.id)
    expect(task.status).toBe("cancelled")
    rejectPrompt(new Error("prompt exploded"))
    await new Promise((r) => setTimeout(r, 20))

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.status).not.toBe("interrupt")
  })

  test("idle-then-error keeps completed (second terminal write is noop)", async () => {
    //#given
    const manager = createManager(dir, {})
    const task = seedTask(manager, { id: "t-idle", sessionID: "ses_idle1", status: "running" })

    //#when
    manager.handleEvent({ type: "session.idle", data: { sessionID: "ses_idle1" } } as unknown as Parameters<
      BackgroundManager["handleEvent"]
    >[0])
    expect(task.status).toBe("completed")
    manager.handleEvent({ type: "session.error", data: { sessionID: "ses_idle1", error: "late" } } as unknown as Parameters<
      BackgroundManager["handleEvent"]
    >[0])

    //#then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
  })

  test("wallclock arm/disarm round-trip: disarm prevents fire, single fire only", async () => {
    //#given
    let fires = 0
    const supervisor = new WallclockSupervisor()
    const startedAt = Date.now()

    //#when
    supervisor.arm("t-wall", startedAt, 30, () => {
      fires++
    })
    expect(supervisor.size()).toBe(1)
    const snap = supervisor.snapshot("t-wall")
    expect(snap).toBeDefined()
    const disarmed = supervisor.disarm("t-wall")

    //#then
    expect(disarmed).toBe(true)
    expect(supervisor.size()).toBe(0)
    await new Promise((r) => setTimeout(r, 60))
    expect(fires).toBe(0)
    supervisor.arm("t-wall", Date.now(), 20, () => {
      fires++
    })
    await new Promise((r) => setTimeout(r, 60))
    expect(fires).toBe(1)
    expect(supervisor.size()).toBe(0)
  })
})
