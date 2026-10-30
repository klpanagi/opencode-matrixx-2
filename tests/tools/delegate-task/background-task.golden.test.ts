/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { BackgroundManager } from "../../../src/features/background-agent"
import { executeBackgroundTask } from "../../../src/tools/delegate-task/background-task"
import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

const TICK = String.fromCharCode(96)
const LAUNCHED = "Background task launched."

describe("golden: background task launch block", () => {
  beforeEach(() => {
    __setTimingConfig({ WAIT_FOR_SESSION_TIMEOUT_MS: 50, WAIT_FOR_SESSION_INTERVAL_MS: 5 })
  })

  afterEach(() => {
    __resetTimingConfig()
  })

  test("renders a byte-identical launch block for a fixed input", async () => {
    //#given a launched task that already has a session id
    const task = {
      id: "golden-task-id",
      sessionID: "ses_golden",
      description: "Golden task",
      agent: "golden-agent",
      status: "running",
    }
    const manager = {
      launch: async () => task,
      getTask: () => task,
    } as unknown as BackgroundManager
    const ctx = {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "test-agent",
      abort: new AbortController().signal,
    }
    const args = {
      description: "Golden task",
      prompt: "Golden prompt",
      category: "test",
      subagent_type: "golden-agent",
      run_in_background: true,
      load_skills: [],
    }
    const executorCtx = { manager, client: { session: { context: async () => ({ messages: [] }) } }, directory: "/tmp" }
    const parentContext = { sessionID: "parent-session", messageID: "parent-message" }

    //#when
    const result = await executeBackgroundTask(
      args as never,
      ctx as never,
      executorCtx as never,
      parentContext as never,
      "golden-agent",
      undefined,
      undefined,
    )

    //#then
    const expected = [
      LAUNCHED,
      "",
      "Task ID: golden-task-id",
      "Description: Golden task",
      "Agent: golden-agent (category: test)",
      "Status: running",
      "",
      "System notifies on completion. Use " + TICK + "background_output" + TICK + " with task_id=\"golden-task-id\" to check.",
      "",
      "<task_metadata>",
      "session_id: ses_golden",
      "</task_metadata>",
    ].join("\n")
    expect(result).toBe(expected)
  })

  test("omits the category suffix when no category is given", async () => {
    //#given a launched task without a category
    const task = {
      id: "golden-task-id",
      sessionID: "ses_golden",
      description: "Golden task",
      agent: "golden-agent",
      status: "running",
    }
    const manager = { launch: async () => task, getTask: () => task } as unknown as BackgroundManager
    const ctx = {
      sessionID: "parent-session",
      messageID: "parent-message",
      agent: "test-agent",
      abort: new AbortController().signal,
    }
    const args = {
      description: "Golden task",
      prompt: "Golden prompt",
      subagent_type: "golden-agent",
      run_in_background: true,
      load_skills: [],
    }
    const executorCtx = { manager, client: { session: { context: async () => ({ messages: [] }) } }, directory: "/tmp" }
    const parentContext = { sessionID: "parent-session", messageID: "parent-message" }

    //#when
    const result = await executeBackgroundTask(
      args as never,
      ctx as never,
      executorCtx as never,
      parentContext as never,
      "golden-agent",
      undefined,
      undefined,
    )

    //#then
    expect(result).toContain("Agent: golden-agent\n")
    expect(result).not.toContain("(category:")
  })
})
