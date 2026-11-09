/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"

import {
  finalizeTask,
  type FinalizeOptions,
} from "../../../src/features/background-agent/manager/finalize"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { TERMINAL_GOLDENS } from "./fixtures/terminal-goldens"
import {
  createManagerRuntime,
  recordNotifications,
} from "./harness/manager-runtime.fixture"

function finalizeOptionsFor(path: string): FinalizeOptions {
  const base = {
    source: `parity-${path}`,
    notify: true,
    removeToast: true,
    recordHistory: true,
  }
  switch (path) {
    case "session.idle":
    case "session.execution.succeeded":
      return { ...base, status: "completed" }
    case "cancel":
      return { ...base, status: "cancelled" }
    case "session.error":
    case "session.execution.failed":
      return { ...base, status: "error", incomingError: "boom" }
    case "wall-clock":
      return {
        ...base,
        status: "error",
        notify: false,
        incomingError: "Wall-clock timeout exceeded",
      }
    default:
      throw new Error(`missing finalize options for ${path}`)
  }
}

describe("finalize notification-count parity with terminal goldens", () => {
  for (const golden of TERMINAL_GOLDENS) {
    test(`${golden.path} notifies ${golden.notifications}x`, async () => {
      //#given
      const runtime = createManagerRuntime()
      const recorder = recordNotifications(runtime)
      const task: BackgroundTask = {
        id: `bg_parity_${golden.path.replaceAll(".", "_")}`,
        sessionID: `ses_parity_${golden.path.replaceAll(".", "_")}`,
        parentSessionID: "ses_parent",
        parentMessageID: "msg_1",
        description: "parity task",
        prompt: "do work",
        agent: "task",
        status: "running",
        startedAt: new Date(0),
      }
      runtime.store.tasks.set(task.id, task)

      try {
        //#when
        await finalizeTask(runtime, task, finalizeOptionsFor(golden.path))

        //#then
        expect(recorder.calls.length).toBe(golden.notifications)
      } finally {
        recorder.dispose()
        runtime.dispose()
      }
    })
  }
})
