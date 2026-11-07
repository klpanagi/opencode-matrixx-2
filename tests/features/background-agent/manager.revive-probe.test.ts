/// <reference types="bun-types" />
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BackgroundTask } from "../../../src/features/background-agent/types"
import { BackgroundManager } from "../../../src/features/background-agent/manager"
import { writeHandle } from "../../../src/features/background-agent/handle-index"
import { DeadReviveTargetError, probeReviveTarget } from "../../../src/features/background-agent/revive"

let TMP_DIR = ""

function makeClient() {
  const promptCalls: Array<Record<string, unknown>> = []
  const native = {
    session: {
      get: async () => ({ directory: TMP_DIR }),
      create: async () => ({ id: "sess_new" }),
      prompt: async (args: Record<string, unknown>) => {
        promptCalls.push(args)
        return {}
      },
      interrupt: async () => ({}),
      context: async () => ({ messages: [] }),
    },
    agent: { list: async () => [] },
    model: { list: async () => [] },
  }
  return { client: native, promptCalls }
}

function makeManager(client: unknown, dir: string): BackgroundManager {
  return new BackgroundManager({ ...(client as Record<string, unknown>), directory: dir } as never)
}

function seedCompletedTask(overrides?: Partial<BackgroundTask>): BackgroundTask {
  const task: BackgroundTask = {
    id: "bg_probe01",
    status: "completed",
    sessionID: "sess_probe01",
    parentSessionID: "sess_parent01",
    parentMessageID: "msg_probe01",
    description: "probe task",
    prompt: "old prompt",
    agent: "oracle",
    completedAt: new Date(),
    ...overrides,
  }
  writeHandle(TMP_DIR, task)
  return task
}

function dirHash(dir: string): string {
  const names = readdirSync(join(dir, ".matrixx", "bg-handles")).sort()
  return names.map((n) => `${n}:${readFileSync(join(dir, ".matrixx", "bg-handles", n), "utf-8")}`).join("|")
}

describe("revive probe", () => {
  beforeEach(() => {
    TMP_DIR = mkdtempSync(join(tmpdir(), "revive-probe-"))
  })

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true })
    } catch { /* best-effort */ }
  })

  test("dead target (disk handle gone) → no resurrect + DeadTarget + state unchanged", async () => {
    //#given an eligible in-memory task whose disk handle expired
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed = seedCompletedTask({ id: "bg_dead01", sessionID: "sess_dead01" })
    const inMemory: BackgroundTask = { ...seed, prompt: "old" }
    mgr["tasks"].set(seed.id, inMemory)
    rmSync(join(TMP_DIR, ".matrixx", "bg-handles", `${seed.id}.json`), { force: true })
    const before = readdirSync(join(TMP_DIR, ".matrixx", "bg-handles")).sort().join(",")

    //#when reviving the dead target
    let thrown: unknown
    try {
      await mgr.revive({
        taskId: seed.id,
        prompt: "should not resurrect",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_dead02",
      })
    } catch (error) {
      thrown = error
    }

    //#then no resurrect, typed DeadTarget, state untouched
    expect(thrown).toBeInstanceOf(DeadReviveTargetError)
    expect((thrown as DeadReviveTargetError).kind).toBe("DeadTarget")
    expect(promptCalls.length).toBe(0)
    expect(mgr["tasks"].get(seed.id)?.status).toBe("completed")
    expect(readdirSync(join(TMP_DIR, ".matrixx", "bg-handles")).sort().join(",")).toBe(before)
    mgr.shutdown()
  })

  test("dead target (stale generation) → no resurrect + DeadTarget", async () => {
    //#given an eligible task whose on-disk generation advanced past the cached epoch
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed = seedCompletedTask({ id: "bg_stale01", sessionID: "sess_stale01" })
    const inMemory: BackgroundTask = { ...seed, prompt: "old", generation: 0 }
    mgr["tasks"].set(seed.id, inMemory)
    mgr["store"].bumpTaskGeneration(seed.id)
    writeHandle(TMP_DIR, seed)
    const before = dirHash(TMP_DIR)

    //#when reviving against the stale epoch
    let thrown: unknown
    try {
      await mgr.revive({
        taskId: seed.id,
        prompt: "should not resurrect",
        parentSessionID: "sess_parent01",
        parentMessageID: "msg_stale02",
      })
    } catch (error) {
      thrown = error
    }

    //#then no resurrect, typed DeadTarget, no new prompt
    expect(thrown).toBeInstanceOf(DeadReviveTargetError)
    expect((thrown as DeadReviveTargetError).kind).toBe("DeadTarget")
    expect((thrown as DeadReviveTargetError).reason).toBe("stale-generation")
    expect(promptCalls.length).toBe(0)
    expect(mgr["tasks"].get(seed.id)?.status).toBe("completed")
    expect(dirHash(TMP_DIR)).toBe(before)
    mgr.shutdown()
  })

  test("live target → revived with bumped generation", async () => {
    //#given a healthy persisted handle
    const { client, promptCalls } = makeClient()
    const mgr = makeManager(client, TMP_DIR)
    const seed = seedCompletedTask({ id: "bg_live01", sessionID: "sess_live01" })
    const genBefore = mgr["store"].currentGeneration(seed.id)

    //#when reviving the live target
    const revived = await mgr.revive({
      taskId: seed.id,
      prompt: "fresh instructions",
      parentSessionID: "sess_parent01",
      parentMessageID: "msg_live02",
    })

    //#then revived + generation bump persisted
    expect(revived.status).toBe("running")
    expect(promptCalls.length).toBe(1)
    expect(mgr["store"].currentGeneration(seed.id)).toBeGreaterThan(genBefore)
    expect(revived.generation).toBe(mgr["store"].currentGeneration(seed.id))
    mgr.shutdown()
  })

  test("probeReviveTarget reports session-dead when liveness check fails", () => {
    //#given a candidate whose session is no longer live
    const seed = seedCompletedTask({ id: "bg_sessdead01", sessionID: "sess_gone01" })

    //#when probing with a failing liveness check
    const result = probeReviveTarget(TMP_DIR, { taskId: seed.id, sessionID: seed.sessionID }, { isSessionLive: () => false })

    //#then dead with session-dead reason and typed error
    expect(result.alive).toBe(false)
    if (!result.alive) {
      expect(result.reason).toBe("session-dead")
      expect(result.error).toBeInstanceOf(DeadReviveTargetError)
    }
  })
})
