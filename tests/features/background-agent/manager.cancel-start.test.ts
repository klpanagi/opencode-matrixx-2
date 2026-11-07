/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"
import { registerSubagentSession } from "../../../src/features/session-state/state"

function buildRuntime(
  dir: string,
  hooks: {
    createImpl?: () => Promise<{ id?: string }>
    promptCalls?: Array<{ sessionID: string; text: string }>
    interruptCalls?: string[]
  },
): ManagerRuntime {
  const store = new ManagerStore(dir)
  const promptCalls = hooks.promptCalls ?? []
  const interruptCalls = hooks.interruptCalls ?? []
  const native = {
    session: {
      create: hooks.createImpl ?? (async () => ({ id: "ses_fresh_1" })),
      prompt: async (args: { sessionID: string; text: string }) => {
        promptCalls.push({ sessionID: args.sessionID, text: args.text })
        return {}
      },
      interrupt: async (args: { sessionID: string }) => {
        interruptCalls.push(args.sessionID)
        return {}
      },
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return {
    store,
    native: native as unknown as ManagerRuntime["native"],
    directory: dir,
    taskHistory: new TaskHistory(),
  }
}

describe("B3 cancel-during-start orphan", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "b3-cancel-start-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("cancel-then-create-resolves aborts fresh session with aborted reason, no bind, no fire", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const interruptCalls: string[] = []
    let resolveCreate!: (value: { id: string }) => void
    let markerSeenDuringCreate = false
    let rtRef: ManagerRuntime | undefined
    const rt = buildRuntime(dir, {
      promptCalls,
      interruptCalls,
      createImpl: () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve
        }),
    })
    rtRef = rt
    const launchP = launchTask(rt, {
      description: "cancel-during-start",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    const task = [...rtRef.store.tasks.values()][0]
    markerSeenDuringCreate = rtRef.store.pendingSpawns.has(task.id)
    task.status = "cancelled"
    task.completedAt = new Date()

    //#when
    resolveCreate({ id: "ses_orphan_1" })
    const result = await launchP
    await new Promise((r) => setTimeout(r, 30))

    //#then
    expect(markerSeenDuringCreate).toBe(true)
    expect(rt.store.pendingSpawns.has(task.id)).toBe(false)
    expect(result.status).toBe("cancelled")
    expect(result.sessionID).toBeUndefined()
    expect(result.terminalReason).toBe("aborted")
    expect(promptCalls.length).toBe(0)
    expect(interruptCalls).toContain("ses_orphan_1")
    expect(rt.store.tasks.size).toBe(1)
  })

  test("orphan session event with cancelled sibling same concurrencyKey skips auto-track", async () => {
    //#given
    const interruptCalls: string[] = []
    const rt = buildRuntime(dir, { interruptCalls })
    const prompt = "do work"
    const concurrencyKey = `ses_parent:morpheus:${prompt.length}:${prompt.slice(0, 120)}`
    rt.store.tasks.set("bg_cancelled_1", {
      id: "bg_cancelled_1",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "cancel-during-start",
      prompt,
      agent: "morpheus",
      status: "cancelled",
      concurrencyKey,
      completedAt: new Date(),
    })
    registerSubagentSession("ses_orphan_1", "ses_parent")

    //#when
    handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: "ses_orphan_1" },
    } as unknown as Parameters<typeof handleManagerEvent>[1])
    await new Promise((r) => setTimeout(r, 10))

    //#then
    expect(rt.store.tasks.size).toBe(1)
    expect(rt.store.findBySession("ses_orphan_1")).toBeUndefined()
  })
})
