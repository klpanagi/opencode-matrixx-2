/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BackgroundManager,
  _resetSessionListCacheForTesting,
  resolveAny,
} from "../../../src/features/background-agent/manager"
import type { NativePluginContext } from "../../../src/plugin/tool/context"

function buildCtx(directory: string, listedIds: string[]): NativePluginContext {
  return {
    directory,
    session: {
      create: async () => ({ id: "ses_new" }),
      prompt: async () => {},
      // `undefined` makes resolveAny fall through to the session.list sweep.
      messages: async () => undefined,
      list: async () => listedIds.map((id) => ({ id })),
    },
  } as unknown as NativePluginContext
}

describe("directory-keyed session list cache", () => {
  let dirA: string
  let dirB: string

  beforeEach(() => {
    dirA = mkdtempSync(join(tmpdir(), "matrixx-bg-dirkey-a-"))
    dirB = mkdtempSync(join(tmpdir(), "matrixx-bg-dirkey-b-"))
    _resetSessionListCacheForTesting()
  })

  afterEach(() => {
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
    _resetSessionListCacheForTesting()
  })

  test("does not leak a foreign id from one directory into another (A first)", async () => {
    //#given two managers rooted in distinct directories with distinct session lists
    const managerA = new BackgroundManager(buildCtx(dirA, ["ses_dir_a"]))
    const managerB = new BackgroundManager(buildCtx(dirB, ["ses_dir_b"]))

    //#when resolving B's id through A, then through B
    const viaA = await resolveAny(managerA, "ses_dir_b")
    const viaB = await resolveAny(managerB, "ses_dir_b")

    //#then A never sees B's id and B classifies it as foreign
    expect(viaA).toEqual({ error: "not_found", id: "ses_dir_b" })
    expect(viaB).toEqual({ origin: "foreign", sessionId: "ses_dir_b", output: [] })
  })

  test("does not leak a foreign id from one directory into another (B first)", async () => {
    //#given two managers rooted in distinct directories with distinct session lists
    const managerA = new BackgroundManager(buildCtx(dirA, ["ses_dir_a"]))
    const managerB = new BackgroundManager(buildCtx(dirB, ["ses_dir_b"]))

    //#when resolving B's id through B first, then through A
    const viaB = await resolveAny(managerB, "ses_dir_b")
    const viaA = await resolveAny(managerA, "ses_dir_b")

    //#then B classifies it as foreign while A still reports not_found
    expect(viaB).toEqual({ origin: "foreign", sessionId: "ses_dir_b", output: [] })
    expect(viaA).toEqual({ error: "not_found", id: "ses_dir_b" })
  })

  test("caches the session list per directory, not globally", async () => {
    //#given two managers and a counter proving per-directory population
    let listCallsA = 0
    let listCallsB = 0
    const managerA = new BackgroundManager({
      directory: dirA,
      session: {
        create: async () => ({ id: "ses_new" }),
        prompt: async () => {},
        messages: async () => undefined,
        list: async () => {
          listCallsA += 1
          return [{ id: "ses_dir_a" }]
        },
      },
    } as unknown as NativePluginContext)
    const managerB = new BackgroundManager({
      directory: dirB,
      session: {
        create: async () => ({ id: "ses_new" }),
        prompt: async () => {},
        messages: async () => undefined,
        list: async () => {
          listCallsB += 1
          return [{ id: "ses_dir_b" }]
        },
      },
    } as unknown as NativePluginContext)

    //#when each manager resolves its own id twice
    expect(await resolveAny(managerA, "ses_dir_a")).toEqual({
      origin: "foreign",
      sessionId: "ses_dir_a",
      output: [],
    })
    expect(await resolveAny(managerB, "ses_dir_b")).toEqual({
      origin: "foreign",
      sessionId: "ses_dir_b",
      output: [],
    })
    expect(await resolveAny(managerA, "ses_dir_a")).toEqual({
      origin: "foreign",
      sessionId: "ses_dir_a",
      output: [],
    })
    expect(await resolveAny(managerB, "ses_dir_b")).toEqual({
      origin: "foreign",
      sessionId: "ses_dir_b",
      output: [],
    })

    //#then each directory primed and reused its own cache entry exactly once
    expect(listCallsA).toBe(1)
    expect(listCallsB).toBe(1)
  })
})
