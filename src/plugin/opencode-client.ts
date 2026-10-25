/**
 * V1 SDK client shim.
 *
 * matrixx was written against `createOpencodeClient()` from `@opencode-ai/sdk`
 * (V1), reaching the server over HTTP. In V2 a plugin runs in-process and is
 * handed a rich plugin context instead of an HTTP client, so this shim backs the
 * V1 method names with the V2 context domains.
 *
 * Every shim method resolves to the V1 envelope shape `{ data }` because matrixx
 * reads `.data` off the response. Methods with no V2 twin are logged once via the
 * proxy fallback and resolve to `{ data: undefined }` so read paths degrade
 * rather than throw.
 */

import { log } from "../shared"
import type { V2Context } from "./opencode-types"

export type V1ClientArgs = {
  path?: Record<string, string>
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  [key: string]: unknown
}

type V1Response<T> = { data: T }

const ok = <T>(data: T): V1Response<T> => ({ data })

const warned = new Set<string>()

function warnUnmapped(path: string): void {
  if (warned.has(path)) return
  warned.add(path)
  log(`[matrixx] unmapped client method: ${path}`)
}

function fallback(path: string): (args?: V1ClientArgs) => Promise<V1Response<undefined>> {
  return () => {
    warnUnmapped(path)
    return Promise.resolve(ok(undefined))
  }
}

/** Wraps a group so that calls to unknown members degrade loudly instead of throwing. */
function group<T extends Record<string, unknown>>(name: string, members: T): T {
  return new Proxy(members, {
    get(target, property, receiver) {
      if (typeof property === "string" && !(property in target)) {
        const fn = fallback(`${name}.${property}`)
        Reflect.set(target, property, fn)
        return fn
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

const idOf = (args?: V1ClientArgs): string => args?.path?.id ?? ""

/**
 * Builds the V1-shaped client used by matrixx's existing hooks and tools.
 * Callers cast the result to the V1 `client` type; the surface here is
 * deliberately loose because the two SDK generations do not share types.
 */
export function createClientShim(ctx: V2Context): Record<string, unknown> {
  const session = group("session", {
    messages: async (args?: V1ClientArgs) => ok(await ctx.session.context({ sessionID: idOf(args) })),
    context: async (args?: V1ClientArgs) => ok(await ctx.session.context({ sessionID: idOf(args) })),
    list: async (args?: V1ClientArgs) => ok(await ctx.session.list(args?.query)),
    get: async (args?: V1ClientArgs) => ok(await ctx.session.get({ sessionID: idOf(args) })),
    create: async (args?: V1ClientArgs) => ok(await ctx.session.create(args?.body)),
    update: async (args?: V1ClientArgs) =>
      ok(await ctx.session.update({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    move: async (args?: V1ClientArgs) =>
      ok(await ctx.session.move({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    delete: async (args?: V1ClientArgs) => ok(await ctx.session.remove({ sessionID: idOf(args) })),
    remove: async (args?: V1ClientArgs) => ok(await ctx.session.remove({ sessionID: idOf(args) })),
    prompt: async (args?: V1ClientArgs) =>
      ok(await ctx.session.prompt({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    promptAsync: async (args?: V1ClientArgs) =>
      ok(await ctx.session.prompt({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    command: async (args?: V1ClientArgs) =>
      ok(await ctx.session.command({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    abort: async (args?: V1ClientArgs) => ok(await ctx.session.interrupt({ sessionID: idOf(args) })),
    interrupt: async (args?: V1ClientArgs) =>
      ok(await ctx.session.interrupt({ sessionID: idOf(args) })),
    summarize: async (args?: V1ClientArgs) => ok(await ctx.session.compact({ sessionID: idOf(args) })),
    compact: async (args?: V1ClientArgs) => ok(await ctx.session.compact({ sessionID: idOf(args) })),
    switchAgent: async (args?: V1ClientArgs) =>
      ok(await ctx.session.switchAgent({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    switchModel: async (args?: V1ClientArgs) =>
      ok(await ctx.session.switchModel({ sessionID: idOf(args), ...(args?.body ?? {}) })),
    wait: async (args?: V1ClientArgs) => ok(await ctx.session.wait({ sessionID: idOf(args) })),
    status: fallback("session.status"),
    init: fallback("session.init"),
    message: fallback("session.message"),
    revert: fallback("session.revert"),
    unrevert: fallback("session.unrevert"),
    share: fallback("session.share"),
    unshare: fallback("session.unshare"),
    children: fallback("session.children"),
    todo: fallback("session.todo"),
  })

  const app = group("app", {
    agents: async () => ok(await ctx.agent.list()),
    get: async () => ok({ name: ctx.app.name, version: ctx.app.version }),
    log: fallback("app.log"),
    init: fallback("app.init"),
  })

  const model = group("model", {
    list: async () => ok(await ctx.model.list()),
  })

  const provider = group("provider", {
    list: async () => ok(await ctx.provider.list()),
  })

  const command = group("command", {
    list: async () => ok(await ctx.command.list()),
  })

  const permission = group("permission", {
    list: async (args?: V1ClientArgs) => ok(await ctx.permission.list(args ?? {})),
    get: async (args?: V1ClientArgs) => ok(await ctx.permission.get(args ?? {})),
    reply: async (args?: V1ClientArgs) => {
      await ctx.permission.reply(args ?? {})
      return ok(true)
    },
  })

  const tui = group("tui", {
    showToast: fallback("tui.showToast"),
    appendPrompt: fallback("tui.appendPrompt"),
    openHelp: fallback("tui.openHelp"),
  })

  const config = group("config", {
    get: fallback("config.get"),
  })

  return group("client", {
    session,
    app,
    model,
    provider,
    command,
    permission,
    tui,
    config,
    find: fallback("find"),
    file: fallback("file"),
  })
}
