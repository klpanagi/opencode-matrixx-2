/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import type { SessionContextCarrier } from "../../../src/shared/session/session-context-source"
import { formatFullSession } from "../../../src/tools/background-task/full-session-format"
import { formatTaskResult } from "../../../src/tools/background-task/task-result-format"
import { formatTaskStatus } from "../../../src/tools/background-task/task-status-format"

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  }
}

function clientReturning(messages: unknown[]): SessionContextCarrier {
  return { session: { context: async () => ({ messages }) } }
}

function assistantMessage(id: string, created: number, text: string) {
  return { id, type: "assistant", time: { created }, content: [{ type: "text", text }] }
}

describe("shared time ordering", () => {
  test("formatTaskResult renders object-time messages chronologically", async () => {
    //#given messages supplied out of order with { time: { created } } objects
    const messages = [
      assistantMessage("m3", 3000, "third"),
      assistantMessage("m1", 1000, "first"),
      assistantMessage("m2", 2000, "second"),
    ]
    const task = createTask({ sessionID: "ses-order-result" })

    //#when formatting the task result
    const output = await formatTaskResult(task, clientReturning(messages))

    //#then the extracted text follows created ascending order
    expect(output.indexOf("first")).toBeGreaterThanOrEqual(0)
    expect(output.indexOf("first")).toBeLessThan(output.indexOf("second"))
    expect(output.indexOf("second")).toBeLessThan(output.indexOf("third"))
  })

  test("formatFullSession renders object-time messages chronologically", async () => {
    //#given messages supplied out of order with { time: { created } } objects
    const messages = [
      assistantMessage("m3", 3000, "third"),
      assistantMessage("m1", 1000, "first"),
      assistantMessage("m2", 2000, "second"),
    ]
    const task = createTask({ sessionID: "ses-order-full" })

    //#when formatting the full session
    const output = await formatFullSession(task, clientReturning(messages), {
      includeThinking: false,
      includeToolResults: false,
    })

    //#then the messages follow created ascending order
    expect(output.indexOf("first")).toBeLessThan(output.indexOf("second"))
    expect(output.indexOf("second")).toBeLessThan(output.indexOf("third"))
  })
})

describe("formatTaskStatus session ID row", () => {
  test("renders a placeholder instead of the literal undefined when sessionID is absent", () => {
    //#given a pending task that has no session yet
    const task = createTask({ sessionID: undefined, status: "pending", queuedAt: new Date("2026-01-01T00:00:00.000Z") })

    //#when formatting the status block
    const output = formatTaskStatus(task)

    //#then the row carries an explicit placeholder, never the string "undefined"
    expect(output).toContain("| Session ID | — |")
    expect(output).not.toContain("undefined")
  })
})

describe("committed snapshots", () => {
  test("formatTaskResult snapshot", async () => {
    //#given a deterministic task and two assistant messages
    const task = createTask()
    const messages = [assistantMessage("m1", 1000, "first"), assistantMessage("m2", 2000, "second")]

    //#when formatting the task result
    const output = await formatTaskResult(task, clientReturning(messages))

    //#then the exact rendered output is pinned
    expect(output).toMatchInlineSnapshot(`
      "Task Result

      Task ID: task-1
      Description: background task
      Duration: 5s
      Session ID: ses-1

      ---

      first

      second"
    `)
  })

  test("formatTaskStatus snapshot", () => {
    //#given a deterministic running task
    const task = createTask()

    //#when formatting the status block
    const output = formatTaskStatus(task)

    //#then the exact rendered output is pinned
    expect(output).toMatchInlineSnapshot(`
      "# Task Status

      | Field | Value |
      |-------|-------|
      | Task ID | \`task-1\` |
      | Description | background task |
      | Agent | test-agent |
      | Status | **running** |
      | Duration | 5s |
      | Session ID | \`ses-1\` |


      > **Note**: No need to wait explicitly - the system will notify you when this task completes.
      ## Original Prompt

      \`\`\`
      do work
      \`\`\`"
    `)
  })
})
