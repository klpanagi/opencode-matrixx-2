/**
 * PR-1a behaviour-neutrality gate (D9).
 *
 * Drives the six terminal paths through `createManagerRuntime` and emits a
 * deterministic table:
 *
 *   path|status|history|notifyCount|bodyHasError|effortLine
 *
 * The table is compared against `PARENT_BASELINE`, which was captured by
 * running this script BEFORE the finalizer refactor (i.e. against the parent
 * commit's terminal call sites, measured on the `feat/bg-handle-substrate`
 * branch tip after the harness notify seam was wired). Measurement method:
 * `git checkout <parent-sha> -- src/features/background-agent` is NOT needed —
 * this script imports only the live call-site modules (`reconcile`,
 * `lifecycle`, `manager`), so checking out the parent commit and running
 * `bun script/pr1a-neutrality.ts` reproduces the table directly.
 *
 * D9 proof: a non-null `effortLine` supplied to each notifying path MUST be
 * visible in the outgoing notification text. This is exercised by calling
 * `finalizeTask` directly with `effortLine: "EFFORT-LINE-SENTINEL"` and
 * asserting the notification text contains it. When the `finalize` module is
 * absent (parent commit), this section prints a skip note.
 *
 * Exit 0 = table matches baseline and D9 holds (or was skipped on parent).
 * Exit 1 = any mismatch.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BackgroundManager } from "../src/features/background-agent/manager"
import { launchTask } from "../src/features/background-agent/manager/lifecycle"
import { handleManagerEvent } from "../src/features/background-agent/manager/reconcile"
import { readHandles } from "../src/features/background-agent/handle-index"
import type { BackgroundTask } from "../src/features/background-agent/types"
import type { MatrixxContext } from "../src/plugin/tool/context"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
  type NotificationRecorder,
} from "../tests/features/background-agent/harness/manager-runtime.fixture"

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

/** Parent-commit measurement. Keep in sync with the committed evidence file. */
const PARENT_BASELINE = [
  "session.idle|completed|true|1|false|none",
  "session.execution.succeeded|completed|true|1|false|none",
  "cancel|cancelled|true|0|false|none",
  "session.error|error|false|1|true|none",
  "session.execution.failed|error|false|1|true|none",
  "wall-clock|error|false|0|false|none",
]

function terminalEvent(type: string, sessionID: string, error?: Record<string, unknown>): HandleEventArg {
  return {
    type,
    sessionID,
    data: { sessionID, ...(error !== undefined ? { error } : {}) },
  } as unknown as HandleEventArg
}

function seedTask(runtime: ManagerRuntimeFixture, id: string, sessionID: string): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "neutrality task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(0),
  }
  runtime.store.tasks.set(task.id, task)
  return task
}

function notificationText(call: unknown): string {
  if (typeof call !== "object" || call === null) return ""
  const text = (call as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

function historyTerminal(runtime: ManagerRuntimeFixture, task: BackgroundTask): boolean {
  const status = runtime.taskHistory
    .getByParentSession(task.parentSessionID)
    .find((entry) => entry.id === task.id)?.status
  return status === task.status
}

function row(
  path: string,
  runtime: ManagerRuntimeFixture,
  recorder: NotificationRecorder,
  task: BackgroundTask,
): string {
  const notifyCount = recorder.calls.length
  const bodyHasError = recorder.calls.some((call) => notificationText(call).includes("**Error:**"))
  const effortLine = notifyCount > 0 && notificationText(recorder.calls[0]).includes("EFFORT-LINE-SENTINEL")
    ? "visible"
    : "none"
  return [
    path,
    task.status,
    String(historyTerminal(runtime, task)),
    String(notifyCount),
    String(bodyHasError),
    effortLine,
  ].join("|")
}

async function measureReconcile(type: string, error?: Record<string, unknown>): Promise<string> {
  const runtime = createManagerRuntime()
  const recorder = recordNotifications(runtime)
  const task = seedTask(runtime, `bg_${type.replaceAll(".", "_")}`, "ses_x")
  try {
    await handleManagerEvent(runtime, terminalEvent(type, "ses_x", error))
    return row(type, runtime, recorder, task)
  } finally {
    recorder.dispose()
    runtime.dispose()
  }
}

async function measureCancel(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "mx-neutral-cancel-"))
  const native = {
    session: {
      create: async () => ({ id: "ses_cancel" }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  const manager = new BackgroundManager({ ...native, directory: dir } as unknown as MatrixxContext)
  const recorder = recordNotifications(manager)
  const task: BackgroundTask = {
    id: "bg_cancel",
    sessionID: "ses_cancel",
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "cancel task",
    prompt: "do work",
    agent: "task",
    status: "running",
    startedAt: new Date(0),
  }
  manager.tasks.set(task.id, task)
  try {
    await manager.cancelTask(task.id)
    return [
      "cancel",
      task.status,
      String(
        manager.taskHistory
          .getByParentSession(task.parentSessionID)
          .find((entry) => entry.id === task.id)?.status === task.status,
      ),
      String(recorder.calls.length),
      String(recorder.calls.some((call) => notificationText(call).includes("**Error:**"))),
      "none",
    ].join("|")
  } finally {
    recorder.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
}

async function measureWallclock(): Promise<string> {
  const runtime = createManagerRuntime({ config: { wallClockTimeoutMs: 30 } })
  const recorder = recordNotifications(runtime)
  try {
    const launched = await launchTask(runtime, {
      description: "wallclock task",
      prompt: "do work",
      agent: "task",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_1",
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    const task = runtime.store.getTask(launched.id) ?? launched
    return row("wall-clock", runtime, recorder, task)
  } finally {
    recorder.dispose()
    runtime.dispose()
  }
}

async function d9EffortThreading(): Promise<boolean> {
  let module: { finalizeTask?: (...args: never[]) => unknown } | undefined
  try {
    module = (await import("../src/features/background-agent/manager/finalize")) as {
      finalizeTask?: (...args: never[]) => unknown
    }
  } catch {
    console.log("D9: skipped (finalize module absent — parent commit)")
    return true
  }
  const finalizeTask = module.finalizeTask as unknown as (
    rt: ManagerRuntimeFixture,
    task: BackgroundTask,
    options: Record<string, unknown>,
  ) => Promise<{ effortLine?: string | null }>
  if (typeof finalizeTask !== "function") {
    console.log("D9: skipped (finalizeTask not exported)")
    return true
  }

  const notifying: Array<{ path: string; status: BackgroundTask["status"]; incomingError?: string }> = [
    { path: "session.idle", status: "completed" },
    { path: "session.execution.succeeded", status: "completed" },
    { path: "session.error", status: "error", incomingError: "boom" },
    { path: "session.execution.failed", status: "error", incomingError: "bang" },
  ]

  let ok = true
  for (const entry of notifying) {
    const runtime = createManagerRuntime()
    const recorder = recordNotifications(runtime)
    const task = seedTask(runtime, `bg_d9_${entry.path.replaceAll(".", "_")}`, "ses_d9")
    try {
      await finalizeTask(runtime, task, {
        status: entry.status,
        source: entry.path,
        notify: true,
        removeToast: false,
        recordHistory: false,
        ...(entry.incomingError !== undefined ? { incomingError: entry.incomingError } : {}),
        effortLine: "EFFORT-LINE-SENTINEL",
        logMessage: null,
      })
      const visible =
        recorder.calls.length === 1 &&
        notificationText(recorder.calls[0]).includes("EFFORT-LINE-SENTINEL")
      if (!visible) {
        console.error(`D9 FAIL: effort line not visible for ${entry.path}`)
        ok = false
      }
    } finally {
      recorder.dispose()
      runtime.dispose()
    }
  }
  console.log(`D9: ${ok ? "effort line visible on all notifying paths" : "FAILED"}`)
  return ok
}

async function main(): Promise<void> {
  const rows = [
    await measureReconcile("session.idle"),
    await measureReconcile("session.execution.succeeded"),
    await measureCancel(),
    await measureReconcile("session.error", { message: "boom" }),
    await measureReconcile("session.execution.failed", { message: "bang" }),
    await measureWallclock(),
  ]

  console.log("path|status|history|notifyCount|bodyHasError|effortLine")
  for (const line of rows) console.log(line)

  const mismatch = rows.findIndex((line, index) => line !== PARENT_BASELINE[index])
  if (mismatch !== -1 || rows.length !== PARENT_BASELINE.length) {
    console.error("BASELINE MISMATCH")
    if (mismatch !== -1) {
      console.error(`expected: ${PARENT_BASELINE[mismatch]}`)
      console.error(`actual:   ${rows[mismatch]}`)
    }
    process.exit(1)
  }

  const d9 = await d9EffortThreading()
  if (!d9) process.exit(1)
  console.log("PR-1a neutrality: OK")
}

await main()
