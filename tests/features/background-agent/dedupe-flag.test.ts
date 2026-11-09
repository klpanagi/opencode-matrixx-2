/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import type { BackgroundTask } from "../../../src/features/background-agent/types"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

const BASE_INPUT = {
  description: "dedupe-flag case",
  prompt: "do the same work",
  agent: "morpheus",
  parentSessionID: "ses_parent",
  parentMessageID: "msg_1",
}

function withRuntime(
  config?: ManagerRuntimeFixture["config"],
): ManagerRuntimeFixture {
  return createManagerRuntime(config === undefined ? {} : { config })
}

function taskCount(rt: ManagerRuntimeFixture): number {
  return [...rt.store.tasks.values()].length
}

function markTerminal(task: BackgroundTask): void {
  task.status = "completed"
  task.completedAt = new Date()
}

describe("background task dedupe behind dedupeActiveDelegations flag", () => {
  let rt: ManagerRuntimeFixture | undefined

  afterEach(() => {
    rt?.dispose()
    rt = undefined
  })

  test("flag absent launches a fresh task instead of reusing the active one", async () => {
    //#given
    rt = withRuntime()
    const input = { ...BASE_INPUT }

    //#when
    const first = await launchTask(rt, { ...input })
    const second = await launchTask(rt, { ...input })

    //#then
    expect(taskCount(rt)).toBe(2)
    expect(second.id).not.toBe(first.id)
  })

  test("flag false launches a fresh task instead of reusing the active one", async () => {
    //#given
    rt = withRuntime({ dedupeActiveDelegations: false })
    const input = { ...BASE_INPUT }

    //#when
    const first = await launchTask(rt, { ...input })
    const second = await launchTask(rt, { ...input })

    //#then
    expect(taskCount(rt)).toBe(2)
    expect(second.id).not.toBe(first.id)
  })

  test("flag true reuses the active task for an identical delegation", async () => {
    //#given
    rt = withRuntime({ dedupeActiveDelegations: true })
    const input = { ...BASE_INPUT }

    //#when
    const first = await launchTask(rt, { ...input })
    const second = await launchTask(rt, { ...input })

    //#then
    expect(taskCount(rt)).toBe(1)
    expect(second.id).toBe(first.id)
  })

  test("flag true does not reuse a terminal task with the same key", async () => {
    //#given
    rt = withRuntime({ dedupeActiveDelegations: true })
    const input = { ...BASE_INPUT }
    const first = await launchTask(rt, { ...input })
    markTerminal(first)

    //#when
    const second = await launchTask(rt, { ...input })

    //#then
    expect(taskCount(rt)).toBe(2)
    expect(second.id).not.toBe(first.id)
  })

  test("flag true does not reuse a task from a different parent session", async () => {
    //#given
    rt = withRuntime({ dedupeActiveDelegations: true })
    const first = await launchTask(rt, {
      ...BASE_INPUT,
      parentSessionID: "ses_parent_a",
    })

    //#when
    const second = await launchTask(rt, {
      ...BASE_INPUT,
      parentSessionID: "ses_parent_b",
    })

    //#then
    expect(taskCount(rt)).toBe(2)
    expect(second.id).not.toBe(first.id)
  })
})
