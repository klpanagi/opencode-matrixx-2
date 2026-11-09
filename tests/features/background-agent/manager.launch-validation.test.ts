/// <reference types="bun-types" />
import { describe, test, expect, afterEach } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { BG_HANDLE_FILE_PREFIX, getBgHandleDir } from "../../../src/features/background-agent/handle-index"
import { launchTask } from "../../../src/features/background-agent/manager/lifecycle"
import type { LaunchInput } from "../../../src/features/background-agent/types"
import type { NativeDomains } from "../../../src/shared/session/session-context-source"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

const VALID_PARENT = "ses_parent_valid_01"
const VALID_MESSAGE = "msg_parent_valid_01"

function buildInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    description: "validation probe",
    prompt: "do work",
    agent: "morpheus",
    parentSessionID: VALID_PARENT,
    parentMessageID: VALID_MESSAGE,
    ...overrides,
  }
}

function persistedHandleFiles(directory: string): string[] {
  const dir = getBgHandleDir(directory)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.startsWith(BG_HANDLE_FILE_PREFIX) && name.endsWith(".json"))
}

describe("launchTask parent validation", () => {
  let runtime: ManagerRuntimeFixture | undefined

  afterEach(() => {
    runtime?.dispose()
    runtime = undefined
  })

  test("rejects a launch without a parent session id and creates nothing", async () => {
    //#given
    runtime = createManagerRuntime()
    const input = buildInput()
    Reflect.deleteProperty(input, "parentSessionID")

    //#when
    const launch = launchTask(runtime, input)

    //#then
    await expect(launch).rejects.toThrow(/parent session/i)
    expect(runtime.store.tasks.size).toBe(0)
    expect(persistedHandleFiles(runtime.directory)).toHaveLength(0)
  })

  test("rejects a launch with a blank parent session id", async () => {
    //#given
    runtime = createManagerRuntime()

    //#when
    const launch = launchTask(runtime, buildInput({ parentSessionID: "   " }))

    //#then
    await expect(launch).rejects.toThrow(/parent session/i)
    expect(runtime.store.tasks.size).toBe(0)
    expect(persistedHandleFiles(runtime.directory)).toHaveLength(0)
  })

  test("rejects a launch without a parent message id and creates nothing", async () => {
    //#given
    runtime = createManagerRuntime()
    const input = buildInput()
    Reflect.deleteProperty(input, "parentMessageID")

    //#when
    const launch = launchTask(runtime, input)

    //#then
    await expect(launch).rejects.toThrow(/parent message/i)
    expect(runtime.store.tasks.size).toBe(0)
    expect(persistedHandleFiles(runtime.directory)).toHaveLength(0)
  })

  test("rejects a launch whose parent session cannot be resolved", async () => {
    //#given
    runtime = createManagerRuntime({
      native: {
        session: {
          context: async () => ({ messages: [] }),
          get: async () => null,
          list: async () => ({}),
          create: async () => ({ id: "ses_harness" }),
          prompt: async () => ({}),
          interrupt: async () => ({}),
          compact: async () => ({}),
          switchAgent: async () => ({}),
          switchModel: async () => ({}),
          wait: async () => ({}),
        },
        agent: { list: async () => [] },
        model: { list: async () => [] },
      } satisfies NativeDomains,
    })

    //#when
    const launch = launchTask(runtime, buildInput({ parentSessionID: "ses_missing_parent" }))

    //#then
    await expect(launch).rejects.toThrow(/parent session/i)
    expect(runtime.store.tasks.size).toBe(0)
    expect(persistedHandleFiles(runtime.directory)).toHaveLength(0)
  })

  test("allows the launch when the parent probe is unverifiable (fail-open)", async () => {
    //#given
    runtime = createManagerRuntime({
      native: {
        session: {
          context: async () => ({ messages: [] }),
          get: async () => {
            throw new Error("transport unavailable")
          },
          list: async () => ({}),
          create: async () => ({ id: "ses_unverifiable_child" }),
          prompt: async () => ({}),
          interrupt: async () => ({}),
          compact: async () => ({}),
          switchAgent: async () => ({}),
          switchModel: async () => ({}),
          wait: async () => ({}),
        },
        agent: { list: async () => [] },
        model: { list: async () => [] },
      } satisfies NativeDomains,
    })

    //#when
    const task = await launchTask(runtime, buildInput({ parentSessionID: "ses_probe_failure" }))

    //#then
    expect(task.parentSessionID).toBe("ses_probe_failure")
    expect(runtime.store.tasks.size).toBe(1)
  })

  test("persists exactly one handle for a valid launch and never stamps the placeholder parent", async () => {
    //#given
    runtime = createManagerRuntime()

    //#when
    const task = await launchTask(runtime, buildInput())

    //#then
    expect(task.parentSessionID).toBe(VALID_PARENT)
    expect(task.parentMessageID).toBe(VALID_MESSAGE)
    expect(runtime.store.tasks.size).toBe(1)
    const files = persistedHandleFiles(runtime.directory)
    expect(files).toHaveLength(1)
    const written = readFileSync(`${getBgHandleDir(runtime.directory)}/${files[0]}`, "utf8")
    expect(written).toContain(VALID_PARENT)
    expect(written).not.toContain("ses_parent\"")
    expect(written).not.toContain("msg_1\"")
  })
})
