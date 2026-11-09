/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
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
    status: "pending",
    queuedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

describe("formatTaskStatus queue note", () => {
  test("pending task renders a truthful queue note with no concurrency-slot wording", () => {
    //#given
    const task = createTask({ status: "pending" })

    //#when
    const output = formatTaskStatus(task)

    //#then
    expect(output).not.toContain("concurrency slot")
    expect(output).toContain("Queued")
    expect(output).toContain("waiting to start")
    expect(output).toContain("Queued for")
  })

  test("bg_ task carrying a concurrencyGroup renders without concurrency-slot wording", () => {
    //#given
    const task = createTask({
      id: "bg_abcdef12",
      status: "pending",
      concurrencyGroup: "group-1",
    })

    //#when
    const output = formatTaskStatus(task)

    //#then
    expect(output).not.toContain("concurrency slot")
    expect(output).toContain("bg_abcdef12")
    expect(output).toContain("waiting to start")
  })
})
