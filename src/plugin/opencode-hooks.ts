/**
 * V1 hook → V2 registration bridge.
 *
 * The matrixx core produces a V1 `Hooks` object. V2 replaced every V1 hook with
 * a domain registration (`ctx.session.hook`, `ctx.tool.hook`,
 * `ctx.tool.transform`, per-domain `transform`s, and the event stream), so each
 * V1 handler is adapted here onto its V2 counterpart.
 *
 * Adapters are defensive: a failing handler is logged and skipped rather than
 * failing the model call, mirroring the core's `safeCreateHook` policy.
 */

import { log } from "../shared"
import { toV1Event } from "./opencode-events"
import { toV2Tool } from "./opencode-tools"
import type {
  V2AgentEditor,
  V2AgentInfo,
  V2Context,
  V2Registration,
  V2SessionContextEvent,
  V2SystemPart,
  V2ToolEditor,
} from "./opencode-types"
import type { ToolsRecord } from "./types"

type V1EventHandler = (input: { event: { type: string; properties?: unknown } }) => Promise<void>
type V1ChatMessageHandler = (
  input: Record<string, unknown>,
  output: { message: unknown; parts: unknown[] },
) => Promise<void>
type V1ChatParamsHandler = (
  input: Record<string, unknown>,
  output: {
    temperature?: number
    topP?: number
    topK?: number
    options?: Record<string, unknown>
  },
) => Promise<void>
type V1MessagesTransformHandler = (
  input: Record<string, unknown>,
  output: { messages: unknown[] },
) => Promise<void>
type V1SystemTransformHandler = (
  input: Record<string, unknown>,
  output: { system: string[] },
) => Promise<void>
type V1CompactingHandler = (
  input: { sessionID: string },
  output: { context: string[] },
) => Promise<void>
type V1ToolBeforeHandler = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: unknown; message?: string },
) => Promise<void>
type V1ToolAfterHandler = (
  input: { tool: string; sessionID: string; callID: string; args: unknown },
  output: { title?: string; output?: string; metadata?: unknown },
) => Promise<void>
type V1ToolDefinitionHandler = (
  input: { toolID: string },
  output: { description?: string; parameters?: unknown },
) => Promise<void>
type V1ConfigHandler = (input: Record<string, unknown>) => Promise<void>

/** The subset of the V1 `Hooks` object the bridge consumes. */
export interface V1HooksLike {
  tool?: ToolsRecord
  event?: V1EventHandler
  config?: V1ConfigHandler
  "chat.message"?: V1ChatMessageHandler
  "chat.params"?: V1ChatParamsHandler
  "experimental.chat.messages.transform"?: V1MessagesTransformHandler
  "experimental.chat.system.transform"?: V1SystemTransformHandler
  "experimental.session.compacting"?: V1CompactingHandler
  "tool.execute.before"?: V1ToolBeforeHandler
  "tool.execute.after"?: V1ToolAfterHandler
  "tool.definition"?: V1ToolDefinitionHandler
}

export interface RegisterV1HooksInput {
  ctx: V2Context
  hooks: V1HooksLike
  directory: string
  worktree: string
}

export interface V1HookBridge {
  registrations: V2Registration[]
  controller: AbortController
  dispose(): Promise<void>
}

async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    log(`[matrixx] ${label} failed`, { error: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

/**
 * The draft carries the V1 MCP entry shape (`enabled`, no discriminator);
 * V2 requires the tagged `type` and spells enablement `disabled`. Fields that
 * would fail the V2 schema (an explicit `undefined`, a non-object `headers`)
 * are dropped, because a schema defect here disables the whole plugin.
 */
function toV2McpConfig(entry: unknown): { type: string; [key: string]: unknown } | undefined {
  const record = asRecord(entry)
  const type =
    record.type ??
    (Array.isArray(record.command) ? "local" : typeof record.url === "string" ? "remote" : undefined)
  if (type !== "local" && type !== "remote") return undefined

  const config: { type: string; [key: string]: unknown } = { type }
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || key === "enabled" || key === "type") continue
    if (key === "headers") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue
      const headers: Record<string, string> = {}
      for (const [header, headerValue] of Object.entries(value)) {
        if (typeof headerValue === "string") headers[header] = headerValue
      }
      config.headers = headers
      continue
    }
    config[key] = value
  }
  if (record.enabled === false) config.disabled = true
  return config
}

async function registerTools(input: RegisterV1HooksInput): Promise<V2Registration[]> {
  const tools = input.hooks.tool
  if (!tools || Object.keys(tools).length === 0) return []

  // `tool.definition` is per-tool and async; precompute overrides before the
  // synchronous transform runs.
  const overrides = new Map<string, { description?: string; parameters?: unknown }>()
  const definitionHandler = input.hooks["tool.definition"]
  if (definitionHandler) {
    for (const name of Object.keys(tools)) {
      const output: { description?: string; parameters?: unknown } = {}
      const applied = await guard(`tool.definition:${name}`, () => definitionHandler({ toolID: name }, output))
      if (applied !== undefined && (output.description !== undefined || output.parameters !== undefined)) {
        overrides.set(name, output)
      }
    }
  }

  const deps = {
    directory: input.directory,
    worktree: input.worktree,
    context: input.ctx,
    assertPermission: async (ask: Record<string, unknown>): Promise<void> => {
      await input.ctx.permission.assert({
        sessionID: ask.sessionID,
        agent: ask.agent,
        action: typeof ask.permission === "string" ? ask.permission : "tool",
        resources: Array.isArray(ask.patterns) ? ask.patterns : [],
        save: Array.isArray(ask.always) ? ask.always : [],
        metadata: ask.metadata,
      })
    },
  }

  const registration = await guard("tool.transform", () =>
    input.ctx.tool.transform((editor: V2ToolEditor) => {
      for (const [name, definition] of Object.entries(tools)) {
        const tool = toV2Tool(name, definition, deps)
        if (tool) editor.add(tool)
      }
      for (const [name, override] of overrides) {
        editor.update(name, (tool) => {
          if (override.description !== undefined) tool.description = override.description
          if (override.parameters !== undefined) tool.input = override.parameters
        })
      }
    }),
  )

  return registration ? [registration] : []
}

function startEventPump(input: RegisterV1HooksInput, controller: AbortController): void {
  const handler = input.hooks.event
  if (!handler) return
  const stream = input.ctx.event.subscribe({ signal: controller.signal })
  void (async () => {
    try {
      for await (const event of stream) {
        await guard(`event:${event.type}`, () => handler(toV1Event(event)))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log("[matrixx] event stream ended", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })()
}

async function registerSessionHooks(input: RegisterV1HooksInput): Promise<V2Registration[]> {
  const { ctx, hooks } = input
  const registrations: V2Registration[] = []

  if (hooks["chat.message"]) {
    const handler = hooks["chat.message"]
    const registration = await guard("session.hook(prompt)", () =>
      ctx.session.hook("prompt", async (event) => {
        // Seed `parts` with the real prompt so handlers that read the text
        // (auto-slash-command, keyword-detector, matrix-loop) see it, then fold
        // the result back into the prompt the request will actually send.
        // `output.message.variant` has no V2 twin on this event and is dropped.
        const output: {
          message: Record<string, unknown>
          parts: Array<{ type: string; text?: string }>
        } = { message: {}, parts: [{ type: "text", text: event.prompt.text }] }
        await handler({ sessionID: event.sessionID, messageID: event.messageID }, output)
        const text = output.parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text ?? "")
          .join("\n")
        if (text.length > 0) event.prompt.text = text
        if (typeof output.message.delivery === "string") event.delivery = output.message.delivery
      }),
    )
    if (registration) registrations.push(registration)
  }

  const applyChatParams = async (event: V2SessionContextEvent): Promise<void> => {
    const handler = hooks["chat.params"]
    if (!handler) return
    const output: {
      temperature?: number
      topP?: number
      topK?: number
      options?: Record<string, unknown>
    } = { options: { ...event.options } }
    await handler({ sessionID: event.sessionID, agent: event.agent, model: event.model }, output)
    if (output.temperature !== undefined) event.options.temperature = output.temperature
    if (output.topP !== undefined) event.options.topP = output.topP
    if (output.topK !== undefined) event.options.topK = output.topK
    if (output.options) event.options = output.options
  }

  const applySystemTransform = async (event: V2SessionContextEvent): Promise<void> => {
    const handler = hooks["experimental.chat.system.transform"]
    if (!handler) return
    const before = event.system.length
    const output = { system: event.system.map((part) => part.text) }
    await handler({ sessionID: event.sessionID }, output)
    for (const text of output.system.slice(before)) {
      if (typeof text === "string" && text.length > 0) {
        event.system.push({ type: "text", text } satisfies V2SystemPart)
      }
    }
  }

  if (
    hooks["chat.params"] ||
    hooks["experimental.chat.system.transform"] ||
    hooks["experimental.chat.messages.transform"]
  ) {
    const registration = await guard("session.hook(context)", () =>
      ctx.session.hook("context", async (event) => {
        // `context` fires for the primary turn only (per-kind dispatch in the
        // host's session/model-request); compaction has its own hook, so the
        // routing discipline reaches primary turns, not auxiliary requests.
        await guard("chat.params", () => applyChatParams(event))
        await guard("system.transform", () => applySystemTransform(event))
        // Stage 4: V2 `messages` are flat `Message[]` while the V1 transform
        // expects `{ info, parts }[]`. Registering the V1 handler here would
        // inject V1-shaped entries into a V2 request, so it stays deferred.
        if (hooks["experimental.chat.messages.transform"]) {
          log("[matrixx] messages transform deferred to Stage 4 (V2 messages are flat; V1 transform expects {info, parts}[])")
        }
      }),
    )
    if (registration) registrations.push(registration)
  }

  if (hooks["experimental.session.compacting"]) {
    const handler = hooks["experimental.session.compacting"]
    const registration = await guard("session.hook(compaction)", () =>
      ctx.session.hook("compaction", async (event) => {
        const output = { context: [] as string[] }
        await handler({ sessionID: event.sessionID }, output)
        for (const text of output.context) {
          if (typeof text === "string" && text.length > 0) {
            event.system.push({ type: "text", text } satisfies V2SystemPart)
          }
        }
      }),
    )
    if (registration) registrations.push(registration)
  }

  return registrations
}

async function registerToolHooks(input: RegisterV1HooksInput): Promise<V2Registration[]> {
  const { ctx, hooks } = input
  const registrations: V2Registration[] = []

  if (hooks["tool.execute.before"]) {
    const handler = hooks["tool.execute.before"]
    const registration = await guard("tool.hook(execute.before)", () =>
      ctx.tool.hook("execute.before", async (event) => {
        const output: { args: unknown; message?: string } = { args: event.input }
        await handler({ tool: event.tool, sessionID: event.sessionID, callID: event.id }, output)
        event.input = output.args
      }),
    )
    if (registration) registrations.push(registration)
  }

  if (hooks["tool.execute.after"]) {
    const handler = hooks["tool.execute.after"]
    const registration = await guard("tool.hook(execute.after)", () =>
      ctx.tool.hook("execute.after", async (event) => {
        if (event.status !== "completed") return
        const metadata = event.result.metadata
        const output: { title?: string; output?: string; metadata?: unknown } = {
          title: typeof metadata?.title === "string" ? metadata.title : undefined,
          output: typeof event.result.content === "string" ? event.result.content : undefined,
          metadata,
        }
        await handler(
          { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
          output,
        )
        if (typeof output.output === "string") event.result.content = output.output
        if (output.metadata && typeof output.metadata === "object") {
          event.result.metadata = output.metadata as Record<string, unknown>
        }
      }),
    )
    if (registration) registrations.push(registration)
  }

  return registrations
}

function applyAgentEntry(agent: V2AgentInfo, entry: unknown): void {
  const next = asRecord(entry)
  if (next.model !== undefined) agent.model = next.model as V2AgentInfo["model"]
  if (typeof next.system === "string") agent.system = next.system
  if (typeof next.description === "string") agent.description = next.description
  if (next.mode === "primary" || next.mode === "subagent" || next.mode === "all") agent.mode = next.mode
  if (typeof next.hidden === "boolean") agent.hidden = next.hidden
  if (typeof next.color === "string") agent.color = next.color
  if (typeof next.steps === "number") agent.steps = next.steps

  const request = asRecord(next.request)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(asRecord(request.headers))) {
    if (typeof value === "string") headers[key] = value
  }
  const body = asRecord(request.body)
  if (Object.keys(body).length > 0 || Object.keys(headers).length > 0) {
    agent.request = {
      settings: { ...(agent.request.settings ?? {}), ...asRecord(request.settings) },
      headers: { ...(agent.request.headers ?? {}), ...headers },
      body: { ...(agent.request.body ?? {}), ...body },
    }
  }

  // MERGE, not replace: evaluation is last-match-wins over
  // `[...Info.default, ...ours]`, so our rules win where they overlap while the
  // seeded ruleset keeps the default `read *.env -> ask` secret-read guard.
  if (Array.isArray(next.permissions)) {
    agent.permissions = [...agent.permissions, ...next.permissions]
  }
}

/**
 * Fans the single V1 `config` mutation out into V2 domain transforms.
 *
 * V1 handed the plugin one mutable config object; V2 removed that hook in favour
 * of per-domain editors. The V1 handler is invoked against a recording draft and
 * the produced entries are replayed onto the matching domains.
 */
async function registerConfigTransforms(input: RegisterV1HooksInput): Promise<V2Registration[]> {
  const handler = input.hooks.config
  if (!handler) return []

  const draft: Record<string, unknown> = {}
  // The V1 handler mutates its argument and returns void, so the draft — not the
  // return value — carries the outcome.
  try {
    await handler(draft)
  } catch (error) {
    log("[matrixx] config failed", { error: error instanceof Error ? error.message : String(error) })
    return []
  }

  const registrations: V2Registration[] = []

  const agents = asRecord(draft.agent ?? draft.agents)
  if (Object.keys(agents).length > 0) {
    const defaultAgent = typeof draft.default_agent === "string" ? draft.default_agent : undefined
    // The agent editor has no `add`; `update` seeds a missing agent from its
    // default, which makes it the registration path as well.
    const registration = await guard("config:agent", () =>
      input.ctx.agent.transform((editor: V2AgentEditor) => {
        for (const [name, entry] of Object.entries(agents)) {
          if (asRecord(entry).disabled === true) {
            editor.remove(name)
            continue
          }
          try {
            editor.update(name, (agent) => applyAgentEntry(agent, entry))
          } catch (error) {
            log("[matrixx] config:agent entry failed", {
              name,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        if (defaultAgent !== undefined) editor.default(defaultAgent)
      }),
    )
    if (registration) registrations.push(registration)
  }

  const mcps = asRecord(draft.mcp)
  if (Object.keys(mcps).length > 0) {
    const registration = await guard("config:mcp", () =>
      input.ctx.mcp.transform((editor) => {
        for (const [name, entry] of Object.entries(mcps)) {
          const config = toV2McpConfig(entry)
          if (!config) continue
          try {
            editor.set(name, config)
          } catch (error) {
            log("[matrixx] config:mcp entry failed", {
              name,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }),
    )
    if (registration) registrations.push(registration)
  }

  for (const key of ["command", "skill"] as const) {
    const count = Object.keys(asRecord(draft[key])).length
    if (count > 0) log(`[matrixx] config:${key} registration deferred to Stage 3`, { entries: count })
  }

  return registrations
}

/**
 * Registers every supported V1 hook onto the V2 context.
 * Returns the bridge whose `dispose` tears down all registrations.
 */
export async function registerV1Hooks(input: RegisterV1HooksInput): Promise<V1HookBridge> {
  const controller = new AbortController()
  const registrations: V2Registration[] = []

  registrations.push(...(await registerTools(input)))
  registrations.push(...(await registerToolHooks(input)))
  registrations.push(...(await registerSessionHooks(input)))
  registrations.push(...(await registerConfigTransforms(input)))
  startEventPump(input, controller)

  return {
    registrations,
    controller,
    dispose: async (): Promise<void> => {
      controller.abort()
      for (const registration of registrations) {
        await guard("dispose", () => registration.dispose())
      }
    },
  }
}
