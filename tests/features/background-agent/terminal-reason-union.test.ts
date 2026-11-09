/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BgHandleSchema, getBgHandleDir, getHandlePath } from "../../../src/features/background-agent/handle-index"
import type { BgHandle } from "../../../src/features/background-agent/handle-index"
import { restoreHandles } from "../../../src/features/background-agent/manager/lifecycle"
import { ManagerStore } from "../../../src/features/background-agent/manager/store"
import type { BackgroundTerminalReason } from "../../../src/features/background-agent/types"
import {
  createManagerRuntime,
  type ManagerRuntimeFixture,
} from "./harness/manager-runtime.fixture"

type AssertNever<T extends never> = T

/** Fails to compile if `stale`/`expired` remain members of the terminal-reason union. */
export type _AssertNoStaleOrExpired = AssertNever<
  Extract<BackgroundTerminalReason, "stale" | "expired">
>

/**
 * The six KEEP members. Type annotation on the array fails to compile if any is
 * dropped from the union; the exhaustive Exclude below fails if any other member
 * is still part of the union.
 */
const ALLOWED_TERMINAL_REASONS = [
  "queue-saturated",
  "no-output",
  "nested-depth-exceeded",
  "uncertain",
  "aborted",
  "wall-clock-timeout",
] as const satisfies readonly BackgroundTerminalReason[]

export type _AssertNoExtraMembers = AssertNever<
  Exclude<BackgroundTerminalReason, (typeof ALLOWED_TERMINAL_REASONS)[number]>
>

let dir: string
const runtimes: ManagerRuntimeFixture[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mx-terminal-reason-"))
  runtimes.length = 0
})

afterEach(() => {
  for (const runtime of runtimes) {
    try {
      runtime.store.wallclock.disarmAll()
      runtime.dispose()
    } catch {
    }
  }
  runtimes.length = 0
  rmSync(dir, { recursive: true, force: true })
})

interface SeedOptions {
  taskId: string
  status: BgHandle["status"]
  terminalReason?: BgHandle["terminalReason"]
  sessionID?: string
}

/** Persist a legacy handle (possibly carrying now-removed reasons) straight to disk. */
function seedLegacyHandle(options: SeedOptions): void {
  const now = Date.now()
  const handle: BgHandle = {
    taskId: options.taskId,
    parentSessionID: "ses_parent",
    parentMessageID: "msg_parent",
    description: `legacy ${options.taskId}`,
    agent: "explore",
    status: options.status,
    sessionID: options.sessionID ?? "ses_legacy_child",
    terminalReason: options.terminalReason,
    completedAt: now,
    startedAt: now,
    lastActivityAt: now,
    generation: 0,
  }
  const parsed = BgHandleSchema.parse(handle)
  mkdirSync(getBgHandleDir(dir), { recursive: true })
  writeFileSync(getHandlePath(dir, options.taskId), JSON.stringify(parsed, null, 2))
}

function makeRuntime(): ManagerRuntimeFixture {
  const runtime = createManagerRuntime({ directory: dir })
  runtimes.push(runtime)
  return runtime
}

describe("BackgroundTerminalReason union", () => {
  test("runtime list of allowed members matches the six kept reasons", () => {
    //#given the compile-time checked ALLOWED_TERMINAL_REASONS literal
    //#when compared to the expected set
    const observed = [...ALLOWED_TERMINAL_REASONS].sort()

    //#then it contains exactly the six kept reasons
    expect(observed).toEqual(
      [
        "aborted",
        "nested-depth-exceeded",
        "no-output",
        "queue-saturated",
        "uncertain",
        "wall-clock-timeout",
      ].sort(),
    )
  })
})

describe("ManagerStore.findDiskTaskBySession restore narrowing (entry point 1)", () => {
  test("completed handle with legacy `stale` reason restores terminalReason === undefined", () => {
    //#given a completed on-disk handle carrying the removed `stale` reason
    seedLegacyHandle({ taskId: "bg_stale001", status: "completed", terminalReason: "stale" })
    const store = new ManagerStore(dir)

    //#when the task is restored from disk by session
    const task = store.findDiskTaskBySession("ses_legacy_child")

    //#then the removed reason is narrowed away
    expect(task).toBeDefined()
    expect(task?.status).toBe("completed")
    expect(task?.terminalReason).toBeUndefined()
  })

  test("completed handle with legacy `expired` reason restores terminalReason === undefined", () => {
    //#given a completed on-disk handle carrying the removed `expired` reason
    seedLegacyHandle({ taskId: "bg_expired001", status: "completed", terminalReason: "expired" })
    const store = new ManagerStore(dir)

    //#when the task is restored from disk by session
    const task = store.findDiskTaskBySession("ses_legacy_child")

    //#then the removed reason is narrowed away
    expect(task).toBeDefined()
    expect(task?.status).toBe("completed")
    expect(task?.terminalReason).toBeUndefined()
  })
})

describe("restoreHandles restore narrowing (entry point 2)", () => {
  test("completed handles with legacy `stale`/`expired` reasons restore terminalReason === undefined", async () => {
    //#given two completed on-disk handles carrying the removed reasons
    seedLegacyHandle({
      taskId: "bg_stale002",
      status: "completed",
      terminalReason: "stale",
      sessionID: "ses_stale_child",
    })
    seedLegacyHandle({
      taskId: "bg_expired002",
      status: "completed",
      terminalReason: "expired",
      sessionID: "ses_expired_child",
    })
    const runtime = makeRuntime()

    //#when handles are restored through the manager path
    await restoreHandles(runtime)

    //#then both removed reasons are narrowed away
    expect(runtime.store.tasks.get("bg_stale002")?.terminalReason).toBeUndefined()
    expect(runtime.store.tasks.get("bg_expired002")?.terminalReason).toBeUndefined()
  })

  test("running handle restores statusUncertain with terminalReason === `uncertain`", async () => {
    //#given a running on-disk handle
    seedLegacyHandle({ taskId: "bg_running002", status: "running", sessionID: "ses_running_child" })
    const runtime = makeRuntime()

    //#when handles are restored through the manager path
    await restoreHandles(runtime)

    //#then uncertainty dominates regardless of any persisted reason
    const task = runtime.store.tasks.get("bg_running002")
    expect(task?.status).toBe("statusUncertain")
    expect(task?.terminalReason).toBe("uncertain")
  })

  test("completed handle with `wall-clock-timeout` keeps its reason", async () => {
    //#given a completed handle carrying a kept reason
    seedLegacyHandle({
      taskId: "bg_wallclock002",
      status: "completed",
      terminalReason: "wall-clock-timeout",
      sessionID: "ses_wallclock_child",
    })
    const runtime = makeRuntime()

    //#when handles are restored through the manager path
    await restoreHandles(runtime)

    //#then the kept reason survives the restore
    expect(runtime.store.tasks.get("bg_wallclock002")?.terminalReason).toBe("wall-clock-timeout")
  })
})
