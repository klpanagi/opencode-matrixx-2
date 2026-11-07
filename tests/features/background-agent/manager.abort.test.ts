/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launchTask, isSettled } from "../../../src/features/background-agent/manager/lifecycle"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"

function buildRuntime(dir: string, hooks: {
  onCreate?: (id: string) => void
  promptCalls?: Array<{ sessionID: string; text: string }>
  interruptCalls?: string[]
  promptImpl?: (args: { sessionID: string; text: string }) => Promise<unknown>
}): ManagerRuntime {
  const store = new ManagerStore(dir)
  const promptCalls = hooks.promptCalls ?? []
  const interruptCalls = hooks.interruptCalls ?? []
  const native = {
    session: {
      create: async () => {
        await new Promise((r) => setTimeout(r, 20))
        const id = "ses_fresh_1"
        hooks.onCreate?.(id)
        return { id }
      },
      prompt: async (args: { sessionID: string; text: string }) => {
        promptCalls.push({ sessionID: args.sessionID, text: args.text })
        if (hooks.promptImpl) return hooks.promptImpl(args)
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

describe("B2 abort-during-await", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "b2-abort-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("cancel-during-pending session.create causes no bind and no fire", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const interruptCalls: string[] = []
    let rtRef: ManagerRuntime | undefined
    const rt = buildRuntime(dir, {
      promptCalls,
      interruptCalls,
      onCreate: () => {
        // simulate cancel racing in-flight session.create: task still pending
        const task = [...rtRef!.store.tasks.values()][0]
        task.status = "cancelled"
        task.completedAt = new Date()
      },
    })
    rtRef = rt

    //#when
    const task = await launchTask(rt, {
      description: "abort-during-create",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    await new Promise((r) => setTimeout(r, 30))

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.sessionID).toBeUndefined()
    expect(promptCalls.length).toBe(0)
    expect(interruptCalls).toContain("ses_fresh_1")
  })

  test("cancel-during-prompt keeps terminal state via isSettled guard", async () => {
    //#given
    const promptCalls: Array<{ sessionID: string; text: string }> = []
    const interruptCalls: string[] = []
    const rt = buildRuntime(dir, {
      promptCalls,
      interruptCalls,
      promptImpl: async () => {
        await new Promise((r) => setTimeout(r, 20))
        throw new Error("prompt failed after cancel")
      },
    })
    const { launchTask: launch } = await import("../../../src/features/background-agent/manager/lifecycle")
    // seed a launch whose prompt will fail, but cancel before it settles
    const launchP = launch(rt, {
      description: "abort-during-prompt",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    const task = await launchP
    // simulate cancel racing in-flight prompt
    task.status = "cancelled"
    task.completedAt = new Date()

    //#when
    await new Promise((r) => setTimeout(r, 80))

    //#then
    expect(isSettled(task.status)).toBe(true)
    expect(task.status).toBe("cancelled")
  })
})
