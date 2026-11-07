import { registerAgentTransform } from "../../agents/shared/agents.transform"
import { registerCommandTransform } from "../../features/builtin-commands/commands.transform"
import { registerMcpTransform } from "../../mcps/mcp.transform"
import { log } from "../../shared"
import { emitToolInfo } from "../../shared/tool/define-tool"
import { registerSkillTransform } from "../../skills/loader/skills.transform"
import { registerMessageHooks } from "../message-hooks"
import type {
  MatrixxContext,
  ToolsRecord,
  V2Event,
  V2Registration,
  V2SessionContextEvent,
  V2SystemPart,
  V2ToolEditor,
} from "../tool/context"
import { createEventDispatcher } from "../tool/event-dispatch"
import type { Hooks } from "../tool/legacy-hooks"

/**
 * Loose handler shapes the V2 registration below relies on.
 * Same runtime shapes the deleted bridge declared; the public
 * boundary stays typed as `Hooks`.
 */
type DomainBridgeHandlers = {
  tool?: ToolsRecord | undefined
  event?: (event: V2Event) => Promise<void>
  config?: (input: Record<string, unknown>) => Promise<void>
  "chat.message"?: (
    input: Record<string, unknown>,
    output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
  ) => Promise<void>
  "chat.params"?: (
    input: Record<string, unknown>,
    output: {
      temperature?: number
      topP?: number
      topK?: number
      options?: Record<string, unknown>
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: Record<string, unknown>,
    output: { system: string[] },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown; message?: string },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: { title?: string; output?: string; metadata?: unknown },
  ) => Promise<void>
  "tool.definition"?: (
    input: { toolID: string },
    output: { description?: string; parameters?: unknown },
  ) => Promise<void>
}

export interface RegisterDomainsInput {
  ctx: MatrixxContext
  hooks: Hooks
  directory: string
  worktree: string
}

export interface DomainRegistration {
  registrations: V2Registration[]
  controller: AbortController
  dispose(): Promise<void>
}

/** Extract hook-visible text from a completed tool result.
 *
 * The host normalizes string content to a [{type: "text", text}] array before
 * hooks run, so a string-only check drops every tool result (observed live as
 * the empty task response). Join text parts; non-text parts contribute nothing.
 */
export function hookOutputText(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const part of content) {
    if (typeof part === "string") {
      texts.push(part)
      continue
    }
    if (part !== null && typeof part === "object") {
      const record = part as Record<string, unknown>
      if (record.type === "text" && typeof record.text === "string") texts.push(record.text)
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined
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


export function hideNativeSubagentTool(editor: { remove(id: string): void }): void {
  try {
    editor.remove("subagent")
  } catch {
    log("[matrixx] native subagent tool not present, skipping hide")
  }
}

async function registerDomainTools(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }): Promise<V2Registration[]> {
  const { ctx, bridge, directory, worktree } = input
  const tools = bridge.tool
  if (!tools || Object.keys(tools).length === 0) return []

  // `tool.definition` is per-tool and async; precompute overrides before the
  // synchronous transform runs.
  const overrides = new Map<string, { description?: string; parameters?: unknown }>()
  const definitionHandler = bridge["tool.definition"]
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
    directory,
    worktree,
    context: ctx,
    assertPermission: async (ask: Record<string, unknown>): Promise<void> => {
      await ctx.permission.assert({
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
    ctx.tool.transform((editor: V2ToolEditor) => {
      for (const [name, definition] of Object.entries(tools)) {
        const tool = emitToolInfo(name, definition as never, deps)
        if (tool) editor.add(tool)
      }
      for (const [name, override] of overrides) {
        editor.update(name, (tool) => {
          if (override.description !== undefined) tool.description = override.description
          if (override.parameters !== undefined) tool.input = override.parameters
        })
      }
      hideNativeSubagentTool(editor)
    }),
  )

  return registration ? [registration] : []
}

function startDomainEventPump(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }, controller: AbortController): void {
  const handler = input.bridge.event
  if (!handler) return
  const dispatcher = createEventDispatcher({ handler, guard, log })
  dispatcher.start(
    (options) => input.ctx.event.subscribe({ signal: options.signal }) as AsyncIterable<V2Event>,
    controller.signal,
  )
}

async function registerDomainSessionHooks(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }): Promise<V2Registration[]> {
  const { ctx, bridge: hooks } = input
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

  if (hooks["chat.params"] || hooks["experimental.chat.system.transform"]) {
    const registration = await guard("session.hook(context)", () =>
      ctx.session.hook("context", async (event) => {
        // `context` fires for the primary turn only (per-kind dispatch in the
        // host's session/model-request); compaction has its own hook, so the
        // routing discipline reaches primary turns, not auxiliary requests.
        await guard("chat.params", () => applyChatParams(event))
        await guard("system.transform", () => applySystemTransform(event))
      }),
    )
    if (registration) registrations.push(registration)
  }

  // Task 25: native per-hook message registrations (flat-Message[] bodies land in Task 26).
  const messageHookRegistrations = await guard("registerMessageHooks", () =>
    registerMessageHooks(ctx),
  )
  if (messageHookRegistrations) registrations.push(...messageHookRegistrations)

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

async function registerDomainToolHooks(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }): Promise<V2Registration[]> {
  const { ctx, bridge: hooks } = input
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
          output: hookOutputText(event.result.content),
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

/**
 * Fans the single `config` mutation out into V2 domain transforms.
 *
 * V1 handed the plugin one mutable config object; V2 removed that hook in favour
 * of per-domain editors. The handler is invoked against a recording draft and
 * the produced entries are replayed onto the matching domains.
 */
async function registerDomainConfigTransforms(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }): Promise<V2Registration[]> {
  const { ctx, bridge } = input
  const handler = bridge.config
  if (!handler) return []

  const draft: Record<string, unknown> = {}
  // The handler mutates its argument and returns void, so the draft — not the
  // return value — carries the outcome.
  try {
    await handler(draft)
  } catch (error) {
    log("[matrixx] config failed", { error: error instanceof Error ? error.message : String(error) })
    return []
  }

  const registrations: V2Registration[] = []

  // Each domain replays its own draft entries through the transform owned by
  // the module that builds those definitions (D4). Matrixx declares no
  // provider/model/integration/reference entries and V2 exposes no
  // vcs/websearch/worktree domains, so those domains get no transform.
  const agents = asRecord(draft.agent ?? draft.agents)
  if (Object.keys(agents).length > 0) {
    const defaultAgent = typeof draft.default_agent === "string" ? draft.default_agent : undefined
    const result = await guard("config:agent", () =>
      registerAgentTransform(ctx.agent, { agents, defaultAgent }),
    )
    if (result) {
      for (const failure of result.failures) {
        log("[matrixx] config:agent entry failed", {
          name: failure.name,
          error: failure.error,
        })
      }
      registrations.push(result.registration as V2Registration)
    }
  }

  const mcps = asRecord(draft.mcp)
  if (Object.keys(mcps).length > 0) {
    const result = await guard("config:mcp", () => registerMcpTransform(ctx.mcp, mcps))
    if (result) {
      if (result.skipped.length > 0) {
        log("[matrixx] config:mcp entries skipped (no V2 shape)", { names: result.skipped })
      }
      registrations.push(result.registration as V2Registration)
    }
  }

  const commands = asRecord(draft.command)
  if (Object.keys(commands).length > 0) {
    const v2ctx = ctx as unknown as {
      session?: {
        switchAgent?: (input: Record<string, unknown>) => Promise<unknown>
        switchModel?: (input: Record<string, unknown>) => Promise<unknown>
        prompt?: (input: Record<string, unknown>) => Promise<unknown>
        create?: (input: Record<string, unknown>) => Promise<unknown>
      }
      agent?: { get?: (input: Record<string, unknown>) => Promise<unknown> }
    }
    const result = await guard("config:command", () =>
      registerCommandTransform(ctx.command, commands, {
        session: v2ctx?.session,
        agent: v2ctx?.agent,
      }),
    )
    if (result) registrations.push(result.registration as V2Registration)
  }

  const skills = asRecord(draft.skill)
  if (Object.keys(skills).length > 0) {
    const result = await guard("config:skill", () =>
      registerSkillTransform(ctx.skill, skills),
    )
    if (result) registrations.push(result.registration as V2Registration)
  }

  return registrations
}

/**
 * Applies the assembled `Hooks` onto the V2 context.
 * Returns the registration set whose `dispose` tears everything down.
 */
export async function registerDomains(input: RegisterDomainsInput): Promise<DomainRegistration> {
  const controller = new AbortController()
  const bridge = input.hooks as unknown as DomainBridgeHandlers
  const full = { ...input, bridge }
  const registrations: V2Registration[] = []

  registrations.push(...(await registerDomainTools(full)))
  registrations.push(...(await registerDomainToolHooks(full)))
  registrations.push(...(await registerDomainSessionHooks(full)))
  registrations.push(...(await registerDomainConfigTransforms(full)))
  startDomainEventPump(full, controller)

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
