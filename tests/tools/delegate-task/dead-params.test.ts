/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createSyncSession } from "../../../src/tools/delegate-task/sync-session-creator"
import { pollSyncSession } from "../../../src/tools/delegate-task/sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "../../../src/tools/delegate-task/timing"

const SRC = join(import.meta.dir, "../../../src")

/** Plain source read — deliberately NOT the pinned `readSrc(...)` form. */
function readToolSource(rel: string): string {
  return readFileSync(join(SRC, rel), "utf-8")
}

const COMPLETED_MESSAGES = [
  { type: "user", id: "m1", content: [{ type: "text", text: "do it" }] },
  { type: "assistant", id: "m2", finish: "stop", content: [{ type: "text", text: "done" }] },
]

const CTX = {
  sessionID: "ses_parent",
  messageID: "msg_1",
  agent: "task",
  abort: { aborted: false },
}

describe("delegate-task dead params", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("createSyncSession needs no defaultDirectory and returns no parentDirectory", async () => {
    //#given a client that only creates sessions
    const client = {
      session: {
        create: async () => ({ id: "ses_new" }),
      },
    }

    //#when creating a session without defaultDirectory in the input
    const result = await createSyncSession(client as never, {
      parentSessionID: "ses_parent",
      agentToUse: "mouse",
      description: "dead params",
    })

    //#then the success result carries only ok and sessionID
    expect(result).toEqual({ ok: true, sessionID: "ses_new" })
    expect(Object.keys(result).sort()).toEqual(["ok", "sessionID"])
    expect("parentDirectory" in result).toBe(false)
  })

  test("pollSyncSession proceeds with only hasActiveChildBackgroundTasks wiring", async () => {
    //#given a session that is already complete and only the child-background guard
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 2000,
    })
    let fetches = 0
    const client = {
      session: {
        context: async () => {
          fetches++
          return { messages: COMPLETED_MESSAGES }
        },
      },
    }

    //#when polling without any hasPendingParentWake callback
    const result = await pollSyncSession(CTX as never, client as never, {
      sessionID: "ses_done",
      agentToUse: "mouse",
      toastManager: null,
      taskId: undefined,
      hasActiveChildBackgroundTasks: () => false,
    })

    //#then the loop observes completion and returns normally
    expect(result).toBeNull()
    expect(fetches).toBeGreaterThan(0)
  })

  test("unstable-agent force-background treats only boolean false as explicit-false", () => {
    //#given the delegate-task tool source
    //(behavior is covered by tools.test.ts "unstable agent forced background mode";
    // this pins the unreachable string arm so the DELETE row stays deleted)
    const source = readToolSource("tools/delegate-task/tools.ts")

    //#when locating the explicit-false predicate
    //#then the boolean arm remains and the string arm is gone
    expect(source).toContain("args.run_in_background === false")
    expect(source).not.toContain('run_in_background === "false"')
  })
})
