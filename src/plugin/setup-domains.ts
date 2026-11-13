/**
 * V2 composition root for the matrixx plugin (TODO 9 / D1).
 *
 * Replaces the 10-step plugin factory, the manager/hook/tool wrapper
 * modules, the plugin-interface assembly, the 3-tier hook grouping, and
 * the generic V1 hook fan-out bridge.
 *
 * Domain setup functions build `Hooks` fragments directly; `registerDomains`
 * applies them onto the V2 context with the same adapters the bridge used
 * (`emitToolInfo` plus per-domain `transform` registrars).
 *
 * Still load-bearing below this module (owned by later TODOs):
 * - the V1 `MatrixxContext` substrate (`./types`) every hook/tool is written against
 * - the 6-phase config pipeline (`../plugin/handlers/config-handler`) that feeds the config draft
 * - the unified compaction hook (Task 8)
 *
 * Native session/background APIs own subagent lifecycle and display (D5):
 * no custom manager, no tmux pane mirror.
 */

import type { HookName, MatrixxConfig, TmuxConfig } from "../config"
import { getBuiltinMcpToolNames, isCommandAvailable } from "../mcps"
import { loadPluginConfig } from "../plugin-config"
import { log } from "../shared"
import { setContextModeForPrompts } from "../shared/policy/context-mode-enforcement"
import { switchProfile } from "../shared/policy/dcp-switch-profile"
import { createFirstMessageVariantGate } from "../shared/session/first-message-variant"
import { resolveSystemDefaultModel } from "../shared/subagent/default-model"
import { startTmuxCheck } from "../tools"
import { setAvailableToolNames } from "./handlers/agent-config-handler"
import { createContinuationHooks } from "./hooks/create-continuation-hooks"
import { createSessionHooks } from "./hooks/create-session-hooks"
import { createSkillHooks } from "./hooks/create-skill-hooks"
import { createToolGuardHooks } from "./hooks/create-tool-guard-hooks"
import { createTransformHooks } from "./hooks/create-transform-hooks"
import type { DomainHooks } from "./setup-domains/hooks"
import {
  setupChatHooks,
  setupCompactionHooks,
  setupToolHooks,
} from "./setup-domains/hooks"
import { createDomainManagers } from "./setup-domains/managers"
import { setupToolsDomain } from "./setup-domains/tools"
import type { MatrixxContext } from "./tool/context"
import { createEventHandler } from "./tool/event"
import type { Hooks } from "./tool/legacy-hooks"
import { createNativePluginContext } from "./tool/native-context"

/**
 * Full init sequence (moved from the 10-step `plugin-factory`).
 * Builds managers, tools, hooks, and the `Hooks` fragments the V2
 * registration below consumes.
 */
export async function setupDomains(ctx: MatrixxContext): Promise<{
  directory: string
  worktree: string
  hooks: Hooks
  pluginConfig: MatrixxConfig
}> {
  log("[MatrixxPlugin] ENTRY - plugin loading", {
    directory: ctx.location?.directory,
  })

  const pctx = createNativePluginContext(ctx)

  startTmuxCheck()

  const pluginConfig = await loadPluginConfig(pctx.directory, pctx)
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
    ctx: pctx,
    pluginConfig,
    tmuxConfig,
  })

  const toolsResult = await setupToolsDomain({
    ctx: pctx,
    pluginConfig,
    systemDefaultModel: () => resolveSystemDefaultModel(ctx),
  })

  // Store tool names for use when building agent prompts
  setAvailableToolNames([
    ...Object.keys(toolsResult.filteredTools),
    ...getBuiltinMcpToolNames({
      disabledMcps: pluginConfig.disabled_mcps ?? [],
      uvxAvailable: isCommandAvailable("uvx"),
    }),
  ])

  const session = createSessionHooks({
    ctx: pctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
  })

  const toolGuard = createToolGuardHooks({
    ctx: pctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
  })

  const transform = createTransformHooks({
    ctx: pctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
  })

  const continuation = createContinuationHooks({
    ctx: pctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    sessionRecovery: session.sessionRecovery,
  })

  const skill = createSkillHooks({
    ctx: pctx,
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
    ctx: pctx,
    pluginConfig,
    firstMessageVariantGate,
    hooks,
  })

  const tool = setupToolHooks({ ctx: pctx, hooks, pluginConfig })
  const compaction = setupCompactionHooks({ hooks })

  const event = createEventHandler({
    ctx: pctx,
    pluginConfig,
    firstMessageVariantGate,
    managers,
    hooks,
  })

  const assembled: Hooks = {
    tool: toolsResult.filteredTools,
    ...chat,
    config: managers.configHandler,
    // Native pump delivers raw V2Event (see startDomainEventPump); the SDK
    // Hooks.event envelope shape is legacy-static only. No runtime change.
    event: event as unknown as Hooks["event"],
    ...tool,
    ...compaction,
  }

  return {
    directory: pctx.directory,
    worktree: pctx.worktree,
    pluginConfig,
    hooks: assembled,
  }
}


export type {
  DomainRegistration,
  RegisterDomainsInput,
} from "./setup-domains/assemble"
export {
  hookOutputText,
  registerDomains,
} from "./setup-domains/assemble"
export type { DomainHooks } from "./setup-domains/hooks"
export {
  setupChatHooks,
  setupCompactionHooks,
  setupToolHooks,
} from "./setup-domains/hooks"
export type { DomainManagers } from "./setup-domains/managers"
export type { SetupToolsDomainResult } from "./setup-domains/tools"
export { setupToolsDomain } from "./setup-domains/tools"
