/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createHostLlmCall } from "../../src/hooks/evolution-compressor/host-llm-call"
import type { EphemeralSessionHandle } from "../../src/shared/with-ephemeral-session"
import { withEphemeralSession } from "../../src/shared/with-ephemeral-session"

function makeIds(): { created: string[]; removed: string[] } {
  return { created: [], removed: [] }
}

function makeSession(opts: {
  createResult: unknown
  promptImpl?: (args: unknown) => Promise<unknown>
  contextImpl?: (args: unknown) => Promise<unknown>
  removeImpl?: (args: unknown) => Promise<unknown>
  tracker: { created: string[]; removed: string[] }
}): EphemeralSessionHandle & {
  prompt: (args: unknown) => Promise<unknown>
  context: (args: unknown) => Promise<unknown>
} {
  return {
    create: async (args: unknown) => {
      opts.tracker.created.push(JSON.stringify(args))
      return opts.createResult
    },
    remove: async (args: unknown) => {
      opts.tracker.removed.push(JSON.stringify(args))
      if (opts.removeImpl) return opts.removeImpl(args)
      return {}
    },
    prompt: async (args: unknown) => (opts.promptImpl ? opts.promptImpl(args) : {}),
    context: async (args: unknown) => (opts.contextImpl ? opts.contextImpl(args) : []),
  }
}

describe("withEphemeralSession", () => {
  test("removes the session on success", async () => {
    //#given a native session handle whose create returns a session id
    const tracker = makeIds()
    const session = makeSession({ createResult: { id: "ses-1" }, tracker })

    //#when the body runs successfully
    const result = await withEphemeralSession({
      session,
      title: "evolution-compressor",
      body: async (id) => `used-${id}`,
    })

    //#then the body result is returned and remove was called for the id
    expect(result).toBe("used-ses-1")
    expect(tracker.removed.length).toBe(1)
    expect(tracker.removed[0]).toContain("ses-1")
  })

  test("removes the session when the body throws and rethrows the original error", async () => {
    //#given a body that throws
    const tracker = makeIds()
    const session = makeSession({ createResult: { id: "ses-2" }, tracker })
    const boom = new Error("body boom")

    //#when the body throws
    const caught = await withEphemeralSession({
      session,
      title: "evolution-compressor",
      body: async () => {
        throw boom
      },
    }).then(
      () => null,
      (err: unknown) => err,
    )

    //#then the original error propagates and remove still ran
    expect(caught).toBe(boom)
    expect(tracker.removed.length).toBe(1)
  })

  test("body error propagates even when remove fails", async () => {
    //#given a body that throws and a remove that rejects
    const tracker = makeIds()
    const session = makeSession({
      createResult: { id: "ses-3" },
      removeImpl: async () => {
        throw new Error("remove failed")
      },
      tracker,
    })
    const boom = new Error("original body error")

    //#when both body and remove fail
    const caught = await withEphemeralSession({
      session,
      title: "evolution-compressor",
      body: async () => {
        throw boom
      },
    }).then(
      () => null,
      (err: unknown) => err,
    )

    //#then the body's error (not the remove error) propagates
    expect(caught).toBe(boom)
    expect(tracker.removed.length).toBe(1)
  })

  test("does not attempt remove when creation yields no id", async () => {
    //#given a create result with no id
    const tracker = makeIds()
    const session = makeSession({ createResult: {}, tracker })

    //#when the body would run
    let bodyRan = false
    const caught = await withEphemeralSession({
      session,
      title: "evolution-compressor",
      body: async () => {
        bodyRan = true
        return "x"
      },
    }).then(
      () => null,
      (err: unknown) => err,
    )

    //#then creation failure throws and remove never ran
    expect(caught).toBeInstanceOf(Error)
    expect(bodyRan).toBe(false)
    expect(tracker.removed.length).toBe(0)
  })

  test("passes parentID through to create", async () => {
    //#given a parent id
    const tracker = makeIds()
    const session = makeSession({ createResult: { id: "ses-4" }, tracker })

    //#when running with a parentID
    await withEphemeralSession({
      session,
      title: "evolution-compressor",
      parentID: "ses-parent",
      body: async () => "ok",
    })

    //#then create carried the parentID
    expect(tracker.created.length).toBe(1)
    expect(tracker.created[0]).toContain("ses-parent")
  })
})

describe("createHostLlmCall session hygiene", () => {
  test("removes the ephemeral session after prompt+messages", async () => {
    //#given a host llm session mock
    const tracker = makeIds()
    const session = makeSession({
      createResult: { id: "ses-host-1" },
      contextImpl: async () => [
        { type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "hello" }] },
      ],
      tracker,
    })

    //#when the llm call runs
    const call = createHostLlmCall({
      ctx: {
        directory: "/tmp",
        session,
      } as never,
    })
    const result = await call("summarize this")

    //#then text is returned and the session was removed
    expect(result.text).toBe("hello")
    expect(tracker.removed.length).toBe(1)
    expect(tracker.removed[0]).toContain("ses-host-1")
  })

  test("removes the ephemeral session when prompt throws", async () => {
    //#given a prompt that throws
    const tracker = makeIds()
    const session = makeSession({
      createResult: { id: "ses-host-2" },
      promptImpl: async () => {
        throw new Error("prompt down")
      },
      tracker,
    })

    //#when the llm call runs
    const call = createHostLlmCall({
      ctx: {
        directory: "/tmp",
        session,
      } as never,
    })
    const caught = await call("summarize this").then(
      () => null,
      (err: unknown) => err,
    )

    //#then the error propagates and the session was removed
    expect(caught).toBeInstanceOf(Error)
    expect(tracker.removed.length).toBe(1)
    expect(tracker.removed[0]).toContain("ses-host-2")
  })
})
