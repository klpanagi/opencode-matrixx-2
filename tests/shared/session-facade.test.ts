import { afterEach, describe, expect, it } from "bun:test"
import { createSessionFacade, type SessionDomainLike } from "../../src/shared/session-facade"

type Call = { method: string; args: unknown }

function recordingDomain(overrides: Partial<Record<keyof SessionDomainLike, unknown>> = {}) {
  const calls: Call[] = []
  const record = (method: string, value: unknown) => {
    calls.push({ method, args: value })
  }
  const domain: SessionDomainLike = {
    context: async (args) => {
      record("context", args)
      return { messages: [{ type: "user", text: "hi" }] }
    },
    get: async (args) => {
      record("get", args)
      return { id: args.sessionID }
    },
    list: async (query) => {
      record("list", query)
      return [{ id: "ses_1" }]
    },
    create: async (body) => {
      record("create", body)
      return { id: "ses_new" }
    },
    prompt: async (args) => {
      record("prompt", args)
      return { ok: true }
    },
    interrupt: async (args) => {
      record("interrupt", args)
      return true
    },
    compact: async (args) => {
      record("compact", args)
      return true
    },
    switchAgent: async (args) => {
      record("switchAgent", args)
      return true
    },
    switchModel: async (args) => {
      record("switchModel", args)
      return true
    },
    wait: async (args) => {
      record("wait", args)
      return "idle"
    },
    ...overrides,
  }
  return { domain, calls }
}

describe("session facade", () => {
  it("reads a session context through the narrow dependency", async () => {
    //#given a recording session domain
    const { domain, calls } = recordingDomain()
    const facade = createSessionFacade({ session: domain })

    //#when the context is requested
    const result = await facade.getContext("ses_1")

    //#then the raw context is returned without an envelope and the id is forwarded
    expect(result).toEqual({ ok: true, value: { messages: [{ type: "user", text: "hi" }] } })
    expect(calls).toEqual([{ method: "context", args: { sessionID: "ses_1" } }])
  })

  it("maps every facade method onto its domain counterpart", async () => {
    //#given a recording session domain
    const { domain, calls } = recordingDomain()
    const facade = createSessionFacade({ session: domain })

    //#when each method is exercised
    await facade.getSession("ses_1")
    await facade.listSessions({ limit: 5 })
    await facade.createSession({ title: "t" })
    await facade.prompt("ses_1", { text: "go" })
    await facade.interrupt("ses_1")
    await facade.compact("ses_1")
    await facade.switchAgent("ses_1", { agent: "morpheus" })
    await facade.switchModel("ses_1", { model: "m" })
    await facade.waitForIdle("ses_1")

    //#then each call reached the matching domain method with the session id merged in
    expect(calls.map((call) => call.method)).toEqual([
      "get",
      "list",
      "create",
      "prompt",
      "interrupt",
      "compact",
      "switchAgent",
      "switchModel",
      "wait",
    ])
    expect(calls[0].args).toEqual({ sessionID: "ses_1" })
    expect(calls[1].args).toEqual({ limit: 5 })
    expect(calls[2].args).toEqual({ title: "t" })
    expect(calls[3].args).toEqual({ sessionID: "ses_1", text: "go" })
    expect(calls[6].args).toEqual({ sessionID: "ses_1", agent: "morpheus" })
  })

  it("returns a typed failure instead of rejecting when the dependency throws", async () => {
    //#given a domain whose context read throws
    const { domain } = recordingDomain({
      context: async () => {
        throw new Error("context exploded")
      },
    })
    const facade = createSessionFacade({ session: domain })

    //#when the context is requested
    const result = await facade.getContext("ses_1")

    //#then the failure is a value, not an exception
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe("context exploded")
  })

  it("settles promptAsync before the generation settles", async () => {
    //#given a prompt that never resolves
    let settled = false
    const { domain } = recordingDomain({
      prompt: () => new Promise(() => {}),
    })
    const facade = createSessionFacade({ session: domain })

    //#when the fire-and-forget prompt is awaited
    const result = await Promise.race([
      facade.promptAsync("ses_1", { text: "go" }),
      Bun.sleep(200).then(() => "timeout" as const),
    ])
    settled = result !== "timeout"

    //#then it returned while the generation is still pending
    expect(settled).toBe(true)
    expect(result).not.toBe("timeout")
  })

  it("swallows a background generation rejection instead of leaking an unhandled rejection", async () => {
    //#given a prompt that rejects after the facade has returned
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", onUnhandled)
    const { domain } = recordingDomain({
      prompt: async () => {
        throw new Error("generation failed")
      },
    })
    const facade = createSessionFacade({ session: domain })

    //#when the fire-and-forget prompt is launched and the loop is given time to settle
    const result = await facade.promptAsync("ses_1", { text: "go" })
    await Bun.sleep(30)
    process.off("unhandledRejection", onUnhandled)

    //#then the launch reported success and no rejection escaped
    expect(result.ok).toBe(true)
    expect(seen).toEqual([])
  })
})

afterEach(() => {
  process.removeAllListeners("unhandledRejection")
})
