/**
 * V2 composition root for the matrixx plugin (TODO 9 / D1).
 *
 * Replaces the 10-step plugin factory, the manager/hook/tool wrapper
 * modules, the plugin-interface assembly, the 3-tier hook grouping, and
 * the generic V1 hook fan-out bridge.
 *
 * Domain setup functions build `Hooks` fragments directly; `registerDomains`
 * applies them onto the V2 context with the same adapters the bridge used
 * (`toV2Tool`, `toV1Event`, per-domain `transform` registrars).
 *
 * Still load-bearing below this module (owned by later TODOs):
 * - the V1 `PluginContext` substrate (`./types`) every hook/tool is written against
 * - the 6-phase config pipeline (`../plugin-handlers/config-handler`) that feeds the config draft
 * - the unified compaction hook (Task 8)
 *
 * Native background/session lifecycle landed in Task 7 (D5): the slim
 * `BackgroundManager` talks to `session.create`/`promptAsync` directly and
 * the tmux pane mirror is gone.
 */

import type { Hooks } from "@opencode-ai/plugin"
import { registerAgentTransform } from "../agents/agents.transform"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../agents/dynamic-agent-prompt-builder"
import type { HookName, MatrixxConfig } from "../config"
import type { BrowserAutomationProvider } from "../config/schema/browser-automation"
import type { BackgroundManager } from "../features/background-agent"
import { BackgroundManager as BackgroundManagerImpl } from "../features/background-agent"
import { registerCommandTransform } from "../features/builtin-commands/commands.transform"
import { initTaskToastManager } from "../features/task-toast-manager"
import { registerMcpTransform } from "../mcps/mcp.transform"
import { loadPluginConfig } from "../plugin-config"
import { createConfigHandler } from "../plugin-handlers"
import { setAvailableToolNames } from "../plugin-handlers/agent-config-handler"
import { createModelCacheState } from "../plugin-state"
import {
  formatCompactionAppendLog,
  injectServerAuthIntoClient,
  log,
  summarizeCompactionAppend,
  utf8ByteLength,
} from "../shared"
import { setContextModeForPrompts } from "../shared/context-mode-enforcement"
import { switchProfile } from "../shared/dcp-switch-profile"
import { createFirstMessageVariantGate } from "../shared/first-message-variant"
import type { NativePluginContext, SessionContextCarrier } from "../shared/session-context-source"
import { resolveTasksConfig } from "../shared/task-system-gating"
import type { BuiltinSkill } from "../skills"
import { registerSkillTransform } from "../skills/skills.transform"
import { startTmuxCheck } from "../tools"
import { resolveSystemDefaultModel } from "../tools/delegate-task/default-model"
import { setPollTimeoutMs } from "../tools/delegate-task/timing"
import { createAvailableCategories } from "./available-categories"
import { createChatMessageHandler } from "./chat-message"
import { createChatParamsHandler } from "./chat-params"
import { createEventHandler } from "./event"
import { createEventPump } from "./event-pump"
import type { ContinuationHooks } from "./hooks/create-continuation-hooks"
import { createContinuationHooks } from "./hooks/create-continuation-hooks"
import type { SessionHooks } from "./hooks/create-session-hooks"
import { createSessionHooks } from "./hooks/create-session-hooks"
import type { SkillHooks } from "./hooks/create-skill-hooks"
import { createSkillHooks } from "./hooks/create-skill-hooks"
import type { ToolGuardHooks } from "./hooks/create-tool-guard-hooks"
import { createToolGuardHooks } from "./hooks/create-tool-guard-hooks"
import type { TransformHooks } from "./hooks/create-transform-hooks"
import { createTransformHooks } from "./hooks/create-transform-hooks"
import { createMessagesTransformHandler } from "./messages-transform"
import { createV1PluginContext } from "./opencode-context"
import { toV1Event } from "./opencode-events"
import { toV2Tool } from "./opencode-tools"
import type {
  V2Context,
  V2Registration,
  V2SessionContextEvent,
  V2SystemPart,
  V2ToolEditor,
} from "./opencode-types"
import { createSkillContext } from "./skill-context"
import { createToolCatalog } from "./tool-catalog"
import { createToolDefinitionHandler } from "./tool-definition"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { PluginContext, TmuxConfig, ToolsRecord } from "./types"

/** Managers owned by the composition root (moved from `create-managers.ts`). */
export type DomainManagers = {
  backgroundManager: BackgroundManager
  configHandler: ReturnType<typeof createConfigHandler>
}

/**
 * Every hook the plugin owns, keyed by domain. Same shape the 3-tier
 * grouping produced — the tiers are gone, the leaf domains remain.
 */
export type DomainHooks = SessionHooks &
  ToolGuardHooks &
  TransformHooks &
  ContinuationHooks &
  SkillHooks

type FirstMessageVariantGate = ReturnType<typeof createFirstMessageVariantGate>

function createDomainManagers(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  tmuxConfig: TmuxConfig
  backgroundNotificationHookEnabled: boolean
}): DomainManagers {
  // D5: native session/background APIs own subagent lifecycle and display.
  // No TmuxSessionManager, no onSubagentSessionCreated pane mirror, no
  // custom reconcile loops. `tmuxConfig` is accepted for signature
  // compatibility only (interactive-bash + doctor read it separately).
  const { ctx, pluginConfig } = args

  const backgroundManager = new BackgroundManagerImpl(
    ctx,
    pluginConfig.background_task,
    { pluginConfig },
  )

  // C5: restore persisted bg handles on plugin startup (fire-and-forget, never blocks init).
  backgroundManager.restoreHandles().catch((error) => {
    log("[index] Failed to restore background handles:", error)
  })

  initTaskToastManager(ctx.client)

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState: createModelCacheState(),
  })

  return {
    backgroundManager,
    configHandler,
  }
}

export type SetupToolsDomainResult = {
  filteredTools: ToolsRecord
  builtinSkills: BuiltinSkill[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
  taskSystemEnabled: boolean
}

/** Tool domain: skill context, categories, and the filtered tool registry. */
export async function setupToolsDomain(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  managers: Pick<DomainManagers, "backgroundManager">
  systemDefaultModel?: () => Promise<string | undefined>
}): Promise<SetupToolsDomainResult> {
  const { ctx, pluginConfig, managers, systemDefaultModel } = args

  const pollTimeout = resolveTasksConfig(pluginConfig).pollTimeoutMs
  if (pollTimeout !== undefined) {
    setPollTimeoutMs(pollTimeout)
  }

  const skillContext = await createSkillContext({
    directory: ctx.directory,
    pluginConfig,
  })

  const availableCategories = createAvailableCategories(pluginConfig)

  const { filteredTools, taskSystemEnabled } = createToolCatalog({
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
    systemDefaultModel,
  })

  return {
    filteredTools,
    builtinSkills: skillContext.builtinSkills,
    availableSkills: skillContext.availableSkills,
    availableCategories,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    taskSystemEnabled,
  }
}

/** Chat domain: message, params, and message/system transforms. */
export function setupChatHooks(args: {
  ctx: PluginContext
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: DomainHooks
}): Pick<
  Hooks,
  | "chat.message"
  | "chat.params"
  | "experimental.chat.messages.transform"
  | "experimental.chat.system.transform"
> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args

  return {
    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "chat.params": createChatParamsHandler({ anthropicEffort: hooks.anthropicEffort }),

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": async (input, output): Promise<void> => {
      await hooks.contextModeRouting(input, output)
      await hooks.rtkRouting(input, output)
    },
  }
}

/** Tool domain: execute guards and tool definition passthrough. */
export function setupToolHooks(args: {
  ctx: PluginContext & SessionContextCarrier
  hooks: DomainHooks
}): Pick<Hooks, "tool.execute.before" | "tool.execute.after" | "tool.definition"> {
  const { ctx, hooks } = args

  return {
    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      hooks,
    }),

    "tool.definition": createToolDefinitionHandler({
      hooks,
    }),
  }
}

/** Compaction domain: the single session-compacting contributor. */
export function setupCompactionHooks(args: {
  hooks: DomainHooks
}): Pick<Hooks, "experimental.session.compacting"> {
  const { hooks } = args

  return {
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      let injectorBytes = 0
      let planBytes = 0
      if (hooks.compactionContextInjector) {
        const fragment = hooks.compactionContextInjector(input.sessionID)
        injectorBytes = utf8ByteLength(fragment)
        output.context.push(fragment)
      }

      // Inject plan context if mission is active
      if (hooks.planPersister) {
        const planContext = hooks.planPersister.buildRehydrationContext(input.sessionID)
        if (planContext) {
          planBytes = utf8ByteLength(planContext)
          output.context.push(planContext)
        }
      }

      const summary = summarizeCompactionAppend({ injector: injectorBytes, plan: planBytes })
      log(formatCompactionAppendLog(input.sessionID, summary.sources), { sessionID: input.sessionID, addedBytes: summary.addedBytes, sources: summary.sources, hostTruncation: "not-performed-by-matrixx" })
    },
  }
}

/**
 * Full init sequence (moved from the 10-step `plugin-factory`).
 * Builds managers, tools, hooks, and the `Hooks` fragments the V2
 * registration below consumes.
 */
export async function setupDomains(ctx: V2Context): Promise<{
  directory: string
  worktree: string
  hooks: Hooks
}> {
  log("[MatrixxPlugin] ENTRY - plugin loading", {
    directory: ctx.location?.directory,
  })

  const v1ctx = createV1PluginContext(ctx)

  injectServerAuthIntoClient(v1ctx.client)
  startTmuxCheck()

  const pluginConfig = await loadPluginConfig(v1ctx.directory, v1ctx)
  setContextModeForPrompts(pluginConfig.context_mode)

  // Auto-activate DCP profile on startup if default_profile is configured
  if (pluginConfig.dcp?.default_profile) {
    switchProfile(pluginConfig.dcp.default_profile, { pluginConfig })
  }

  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])

  const isHookEnabled = (hookName: HookName): boolean => !disabledHooks.has(hookName)
  const safeHookEnabled = pluginConfig.experimental?.safe_hook_creation ?? true

  const firstMessageVariantGate = createFirstMessageVariantGate()

  const tmuxConfig: TmuxConfig = {
    enabled: pluginConfig.tmux?.enabled ?? false,
    layout: pluginConfig.tmux?.layout ?? "main-vertical",
    main_pane_size: pluginConfig.tmux?.main_pane_size ?? 60,
    main_pane_min_width: pluginConfig.tmux?.main_pane_min_width ?? 120,
    agent_pane_min_width: pluginConfig.tmux?.agent_pane_min_width ?? 40,
  }

  const managers = createDomainManagers({
    ctx: v1ctx,
    pluginConfig,
    tmuxConfig,
    backgroundNotificationHookEnabled: isHookEnabled("background-notification"),
  })

  const toolsResult = await setupToolsDomain({
    ctx: v1ctx,
    pluginConfig,
    managers,
    systemDefaultModel: () => resolveSystemDefaultModel(ctx),
  })

  // Store tool names for use when building agent prompts
  setAvailableToolNames(Object.keys(toolsResult.filteredTools))

  const session = createSessionHooks({
    ctx: v1ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
  })

  const toolGuard = createToolGuardHooks({
    ctx: v1ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
  })

  const transform = createTransformHooks({
    ctx: v1ctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
  })

  const continuation = createContinuationHooks({
    ctx: v1ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager: managers.backgroundManager,
    sessionRecovery: session.sessionRecovery,
  })

  const skill = createSkillHooks({
    ctx: v1ctx,
    isHookEnabled,
    safeHookEnabled,
    builtinSkills: toolsResult.builtinSkills,
    availableSkills: toolsResult.availableSkills,
  })

  const hooks: DomainHooks = {
    ...session,
    ...toolGuard,
    ...transform,
    ...continuation,
    ...skill,
  }

  const chat = setupChatHooks({
    ctx: v1ctx,
    pluginConfig,
    firstMessageVariantGate,
    hooks,
  })

  const tool = setupToolHooks({ ctx: v1ctx, hooks })
  const compaction = setupCompactionHooks({ hooks })

  const event = createEventHandler({
    ctx: v1ctx,
    pluginConfig,
    firstMessageVariantGate,
    managers,
    hooks,
  })

  const assembled: Hooks = {
    tool: toolsResult.filteredTools,
    ...chat,
    config: managers.configHandler,
    event,
    ...tool,
    ...compaction,
  }

  return {
    directory: v1ctx.directory,
    worktree: v1ctx.worktree,
    hooks: assembled,
  }
}

/**
 * Loose handler shapes the V2 registration below relies on.
 * Same runtime shapes the deleted bridge declared; the public
 * boundary stays typed as `Hooks`.
 */
type DomainBridgeHandlers = {
  tool?: ToolsRecord | undefined
  event?: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
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
  "experimental.chat.messages.transform"?: (
    input: Record<string, unknown>,
    output: { messages: unknown[] },
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
  ctx: V2Context
  hooks: Hooks
  directory: string
  worktree: string
}

export interface DomainRegistration {
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

function startDomainEventPump(input: RegisterDomainsInput & { bridge: DomainBridgeHandlers }, controller: AbortController): void {
  const handler = input.bridge.event
  if (!handler) return
  createEventPump({
    subscribe: (o) => input.ctx.event.subscribe({ signal: o.signal }),
    handler,
    signal: controller.signal,
    guard,
    log,
    toV1Event,
  }).start()
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
