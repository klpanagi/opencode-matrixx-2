import { $ } from "bun"
import { describe, expect, it } from "bun:test"
import type { MatrixxContext, V2Registration } from "../../src/plugin/context"

//#given a factory for the promise-flavor registration every transform/hook returns
function registration(): V2Registration {
  return {
    dispose: async () => {},
  }
}

//#given a builder for the minimal context literal the host hands to `setup()`
export function minimalContext(): MatrixxContext {
  const directory = "/tmp/mx-context-test"
  const project = { id: "matrixx-test", directory, canonical: directory }
  return {
    app: { name: "opencode", version: "v2.1.4-test", channel: "test" },
    location: { directory, project },
    options: {},
    directory,
    worktree: directory,
    project,
    $,
    notify: () => {},
    session: {
      hook: async () => registration(),
      list: async () => [],
      get: async () => undefined,
      create: async () => undefined,
      update: async () => undefined,
      move: async () => undefined,
      remove: async () => undefined,
      switchAgent: async () => undefined,
      switchModel: async () => undefined,
      prompt: async () => undefined,
      generate: async () => undefined,
      command: async () => undefined,
      compact: async () => undefined,
      synthetic: async () => undefined,
      interrupt: async () => undefined,
      wait: async () => undefined,
      context: async () => undefined,
    },
    tool: {
      transform: async () => registration(),
      list: async () => [],
      reload: async () => {},
      hook: async () => registration(),
    },
    event: {
      subscribe: () =>
        (async function* () {
          yield { type: "test.event" }
        })(),
    },
    agent: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    command: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    mcp: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    skill: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    model: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    provider: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    reference: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    integration: {
      list: async () => undefined,
      transform: async () => registration(),
      reload: async () => {},
    },
    permission: {
      assert: async () => {},
      list: async () => undefined,
      get: async () => undefined,
      reply: async () => {},
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    },
    shell: {
      hook: async () => registration(),
    },
  }
}

describe("plugin/context", () => {
  //#when the minimal literal is built against MatrixxContext
  //#then every domain member resolves in promise flavor
  it("compiles a minimal context literal with promise-flavor domains", async () => {
    const ctx = minimalContext()
    expect(ctx.directory).toBe("/tmp/mx-context-test")
    expect(ctx.worktree).toBe("/tmp/mx-context-test")
    expect(ctx.project.id).toBe("matrixx-test")
    expect(typeof ctx.notify).toBe("function")
    expect(typeof ctx.session.hook).toBe("function")
    expect(typeof ctx.tool.transform).toBe("function")
    expect(typeof ctx.permission.assert).toBe("function")
    expect(typeof ctx.storage.get).toBe("function")
    expect(typeof ctx.shell.hook).toBe("function")
    //#then the removed V1 `config` domain is absent (Phase 0 P4)
    expect("config" in ctx).toBe(false)
    //#then transform/hook registration resolves a disposable
    const registration = await ctx.tool.transform(() => {})
    expect(typeof registration.dispose).toBe("function")
    await registration.dispose()
  })

  it("event.subscribe answers an async iterable of flat events", async () => {
    //#given the minimal context
    const ctx = minimalContext()
    //#when subscribing
    const seen: string[] = []
    for await (const event of ctx.event.subscribe()) {
      seen.push(event.type)
    }
    //#then the flat `{type, ...}` shape arrives (Phase 0 P6)
    expect(seen).toEqual(["test.event"])
  })
})
