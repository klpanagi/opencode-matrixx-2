/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readHandles } from "../../../src/features/background-agent/handle-index"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"

function buildRuntime(
  dir: string,
  hooks: {
    createImpl?: () => Promise<{ id?: string }>
  },
): ManagerRuntime {
  const store = new ManagerStore(dir)
  const native = {
    session: {
      create: hooks.createImpl ?? (async () => ({ id: "ses_fresh_1" })),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      context: async () => ({ messages: [{ type: "assistant", content: [{ type: "text", text: "ok" }] }] }),
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

describe("launchTask reindexes sessionID at the assignment site", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bg-launch-reindex-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("session assigned after a forced rebuild is immediately resolvable", async () => {
    //#given
    let resolveCreate!: (value: { id: string }) => void
    const rt = buildRuntime(dir, {
      createImpl: () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve
        }),
    })
    const launchP = launchTask(rt, {
      description: "reindex-after-rebuild",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    // Force a rebuild while the launch is still pending on session.create.
    const beforeResolve = rt.store.findBySession("ses_absent")
    expect(beforeResolve).toBeUndefined()
    expect(rt.store.tasks.dirty).toBe(false)

    //#when
    resolveCreate({ id: "ses_real" })
    const launched = await launchP

    //#then
    expect(rt.store.tasks.dirty).toBe(false)
    expect(rt.store.findBySession("ses_real")?.id).toBe(launched.id)
    expect(rt.store.getTasksByParentSession("ses_parent")).toHaveLength(1)
  })

  test("a session.created event after launch adds no second task", async () => {
    //#given
    let resolveCreate!: (value: { id: string }) => void
    const rt = buildRuntime(dir, {
      createImpl: () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve
        }),
    })
    const launchP = launchTask(rt, {
      description: "reindex-created-event",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    rt.store.findBySession("ses_absent")
    resolveCreate({ id: "ses_real" })
    await launchP

    //#when
    await handleManagerEvent(rt, {
      type: "session.created",
      data: { sessionID: "ses_real" },
    })

    //#then
    expect(rt.store.getTasksByParentSession("ses_parent")).toHaveLength(1)
    expect(
      [...rt.store.tasks.values()].filter((task) => task.agent === "native"),
    ).toHaveLength(0)
  })

  test("session.idle completes the single task", async () => {
    //#given
    let resolveCreate!: (value: { id: string }) => void
    const rt = buildRuntime(dir, {
      createImpl: () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve
        }),
    })
    const launchP = launchTask(rt, {
      description: "reindex-idle",
      prompt: "do work",
      agent: "morpheus",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    rt.store.findBySession("ses_absent")
    resolveCreate({ id: "ses_real" })
    const launched = await launchP

    //#when
    await handleManagerEvent(rt, {
      type: "session.idle",
      data: { sessionID: "ses_real" },
    })

    //#then
    expect(launched.status).toBe("completed")
    const handles = readHandles(dir).filter(
      (handle) => handle.sessionID === "ses_real",
    )
    expect(handles).toHaveLength(1)
  })
})
