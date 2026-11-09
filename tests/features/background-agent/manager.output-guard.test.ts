/// <reference types="bun-types" />
/**
 * T-21 — output guard wired into both `completed` terminal transitions.
 *
 * Decision register D1: a session is only complete when it produced at least
 * one assistant or tool message. Zero-message sessions must land on `error`
 * with terminalReason `no-output`; analysis-only content is completed with a
 * single warning; transport failures fail open (see output-guard-failopen).
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  messagesHaveAssistantOutput,
  stripAnalysisBlocks,
  validateSessionHasOutput,
} from "../../../src/features/background-agent/manager/output-guard"
import { handleManagerEvent } from "../../../src/features/background-agent/manager/reconcile"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { SessionMessage } from "../../../src/shared/session/session-message"
import {
  createManagerRuntime,
  recordNotifications,
  type ManagerRuntimeFixture,
  type NotificationRecorder,
} from "./harness/manager-runtime.fixture"

type HandleEventArg = Parameters<typeof handleManagerEvent>[1]

function nativeWithContext(
  context: () => Promise<unknown>,
): ManagerRuntimeFixture["native"] {
  const ok = async () => ({})
  return {
    session: {
      context,
      get: ok,
      list: ok,
      create: async () => ({ id: "ses_guard" }),
      prompt: ok,
      interrupt: ok,
      compact: ok,
      switchAgent: ok,
      switchModel: ok,
      wait: ok,
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
}

function runtimeWithMessages(messages: readonly SessionMessage[]): ManagerRuntimeFixture {
  return createManagerRuntime({
    native: nativeWithContext(async () => ({ messages })),
  })
}

function seedTask(runtime: ManagerRuntimeFixture, id: string, sessionID: string): BackgroundTask {
  const task: BackgroundTask = {
    id,
    sessionID,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_1",
    description: "output guard task",
    prompt: "do work",
    agent: "morpheus",
    status: "running",
    startedAt: new Date(0),
  }
  runtime.store.tasks.set(task.id, task)
  return task
}

function terminalEvent(type: string, sessionID: string): HandleEventArg {
  return { type, sessionID, data: { sessionID } } as unknown as HandleEventArg
}

function notificationText(call: unknown): string {
  if (typeof call !== "object" || call === null) return ""
  const text = (call as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

describe("output guard runtime consumers", () => {
  let runtime: ManagerRuntimeFixture
  let recorder: NotificationRecorder | undefined

  afterEach(() => {
    recorder?.dispose()
    runtime?.dispose()
  })

  test("session.idle with zero messages errors the task instead of completing", async () => {
    //#given a running task whose session produced no messages at all
    runtime = runtimeWithMessages([])
    recorder = recordNotifications(runtime)
    const task = seedTask(runtime, "bg_guard_idle", "ses_guard_idle")

    //#when the native idle event arrives
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_guard_idle"))

    //#then the task is errored by the output guard and the parent sees the error body
    expect(task.status).toBe("error")
    expect(task.terminalReason).toBe("no-output")
    expect(task.error).toBe("Session produced no assistant or tool output")
    expect(recorder.calls).toHaveLength(1)
    expect(notificationText(recorder.calls[0])).toContain("**Error:**")
  })

  test("session.execution.succeeded with zero messages errors the task instead of completing", async () => {
    //#given a running task whose session produced no messages at all
    runtime = runtimeWithMessages([])
    recorder = recordNotifications(runtime)
    const task = seedTask(runtime, "bg_guard_exec", "ses_guard_exec")

    //#when the native execution-succeeded event arrives
    await handleManagerEvent(runtime, terminalEvent("session.execution.succeeded", "ses_guard_exec"))

    //#then the second completed transition is guarded by the same contract
    expect(task.status).toBe("error")
    expect(task.terminalReason).toBe("no-output")
    expect(task.error).toBe("Session produced no assistant or tool output")
    expect(recorder.calls).toHaveLength(1)
    expect(notificationText(recorder.calls[0])).toContain("**Error:**")
  })

  test("session.idle with assistant text completes the task", async () => {
    //#given a session that produced an assistant text block
    runtime = runtimeWithMessages([
      { type: "assistant", content: [{ type: "text", text: "done: migrated 3 files" }] },
    ])
    recorder = recordNotifications(runtime)
    const task = seedTask(runtime, "bg_guard_text", "ses_guard_text")

    //#when idle arrives
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_guard_text"))

    //#then the task completes normally
    expect(task.status).toBe("completed")
    expect(task.terminalReason).toBeUndefined()
    expect(recorder.calls).toHaveLength(1)
    expect(notificationText(recorder.calls[0])).not.toContain("**Error:**")
  })

  test("analysis-only content completes the task (never errors)", async () => {
    //#given an assistant message that only carries an <analysis> block
    runtime = runtimeWithMessages([
      { type: "assistant", content: [{ type: "text", text: "<analysis>thinking</analysis>" }] },
    ])
    recorder = recordNotifications(runtime)
    const task = seedTask(runtime, "bg_guard_analysis", "ses_guard_analysis")

    //#when idle arrives
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_guard_analysis"))

    //#then D1 treats analysis-only output as completed with one warning, not an error
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
    expect(recorder.calls).toHaveLength(1)
    expect(notificationText(recorder.calls[0])).not.toContain("**Error:**")
  })

  test("tool-only content completes the task", async () => {
    //#given a session whose only substantive message is a tool result
    runtime = runtimeWithMessages([
      { type: "tool", content: [{ type: "tool_result", content: "exit 0" }] },
    ])
    recorder = recordNotifications(runtime)
    const task = seedTask(runtime, "bg_guard_tool", "ses_guard_tool")

    //#when idle arrives
    await handleManagerEvent(runtime, terminalEvent("session.idle", "ses_guard_tool"))

    //#then tool output counts as real work
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
  })
})

describe("output guard module contract", () => {
  test("validateSessionHasOutput is exported from manager/output-guard", () => {
    //#given the guard module imported above
    //#when inspecting the runtime export
    const exported: unknown = validateSessionHasOutput

    //#then the wiring consumers share this exact export
    expect(typeof exported).toBe("function")
  })

  test("zero assistant and zero tool messages is not output", () => {
    //#given only user/system messages
    const messages: SessionMessage[] = [{ type: "user" }, { type: "system" }]

    //#when evaluating output presence
    const hasOutput = messagesHaveAssistantOutput(messages, "ses_none")

    //#then the session is incomplete
    expect(hasOutput).toBe(false)
  })

  test("analysis blocks are stripped before judging content", () => {
    //#given an analysis-only text block
    const stripped = stripAnalysisBlocks("<analysis>plan</analysis> hello")

    //#then only the real text survives
    expect(stripped.trim()).toBe("hello")
  })

  test("analysis-only content is treated as output", () => {
    //#given an assistant message that only carries an analysis block
    const messages: SessionMessage[] = [
      { type: "assistant", content: [{ type: "text", text: "<analysis>thinking</analysis>" }] },
    ]

    //#when evaluating output presence
    const hasOutput = messagesHaveAssistantOutput(messages, "ses_analysis")

    //#then D1 completes analysis-only sessions instead of erroring them
    expect(hasOutput).toBe(true)
  })
})
