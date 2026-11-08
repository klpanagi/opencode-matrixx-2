/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { ManagerRuntime } from "../../../src/features/background-agent/manager/types"
import { TaskHistory } from "../../../src/features/background-agent/task-history"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import {
  registerSubagentSession,
  unregisterSubagentSession,
} from "../../../src/features/session-state/state"

function buildRuntime(dir: string): ManagerRuntime {
  const store = new ManagerStore(dir)
  const native = {
    session: {
      create: async () => ({ id: "ses_fresh_1" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
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

describe("handleManagerEvent auto-track synchronous coverage guard", () => {
  let dir: string
  let rt: ManagerRuntime

  beforeEach(() => {
    //#given
    dir = mkdtempSync(join(tmpdir(), "mgr-auto-track-guard-"))
    rt = buildRuntime(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("event for a covered session never fabricates a native task", async () => {
    //#given
    const bgReal: BackgroundTask = {
      id: "bg_real",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "real",
      prompt: "p",
      agent: "morpheus",
      status: "running",
    }
    rt.store.tasks.set("bg_real", bgReal)
    rt.store.findBySession("ses_absent")
    expect(rt.store.tasks.dirty).toBe(false)
    try {
      registerSubagentSession("ses_covered", "ses_parent")
      bgReal.sessionID = "ses_covered"

      //#when
      await handleManagerEvent(rt, {
        type: "session.created",
        data: { sessionID: "ses_covered" },
      })

      //#then
      expect(rt.store.tasks.size).toBe(1)
      expect([...rt.store.tasks.values()].some((t) => t.agent === "native")).toBe(false)
      expect(rt.store.getTasksByParentSession("ses_parent")).toHaveLength(1)
      expect(rt.store.findBySession("ses_covered")?.id).toBe("bg_real")
    } finally {
      unregisterSubagentSession("ses_covered")
    }
  })

  test("duplicate delivery of the same event stays covered", async () => {
    //#given
    const bgReal: BackgroundTask = {
      id: "bg_real",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "real",
      prompt: "p",
      agent: "morpheus",
      status: "running",
    }
    rt.store.tasks.set("bg_real", bgReal)
    rt.store.findBySession("ses_absent")
    try {
      registerSubagentSession("ses_covered", "ses_parent")
      bgReal.sessionID = "ses_covered"
      await handleManagerEvent(rt, {
        type: "session.created",
        data: { sessionID: "ses_covered" },
      })

      //#when
      await handleManagerEvent(rt, {
        type: "session.created",
        data: { sessionID: "ses_covered" },
      })

      //#then
      expect(rt.store.tasks.size).toBe(1)
    } finally {
      unregisterSubagentSession("ses_covered")
    }
  })

  test("adoption transition still processes session.idle for the real task", async () => {
    //#given
    const bgReal: BackgroundTask = {
      id: "bg_real",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "real",
      prompt: "p",
      agent: "morpheus",
      status: "running",
    }
    rt.store.tasks.set("bg_real", bgReal)
    rt.store.findBySession("ses_absent")
    try {
      registerSubagentSession("ses_covered", "ses_parent")
      bgReal.sessionID = "ses_covered"
      await handleManagerEvent(rt, {
        type: "session.created",
        data: { sessionID: "ses_covered" },
      })

      //#when
      await handleManagerEvent(rt, {
        type: "session.idle",
        data: { sessionID: "ses_covered" },
      })

      //#then
      expect(bgReal.status).toBe("completed")
    } finally {
      unregisterSubagentSession("ses_covered")
    }
  })

  test("legit native session still auto-tracks", async () => {
    //#given
    const bgReal: BackgroundTask = {
      id: "bg_real",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
      description: "real",
      prompt: "p",
      agent: "morpheus",
      status: "running",
      sessionID: "ses_covered",
    }
    rt.store.tasks.set("bg_real", bgReal)
    registerSubagentSession("ses_native", "ses_parent")

    try {
      //#when
      await handleManagerEvent(rt, {
        type: "session.created",
        data: { sessionID: "ses_native" },
      })

      //#then
      const natives = [...rt.store.tasks.values()].filter((t) => t.agent === "native")
      expect(natives).toHaveLength(1)
      expect(natives[0]?.sessionID).toBe("ses_native")
      expect(rt.store.tasks.size).toBe(2)
    } finally {
      unregisterSubagentSession("ses_native")
    }
  })
})
