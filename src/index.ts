/**
 * Matrixx — OpenCode plugin entrypoint.
 *
 * OpenCode 2.x loads a plugin by decoding its default export against
 * `{ id, effect } | { id, setup }` (packages/core/src/plugin/module.ts). This
 * file is that entrypoint: it builds the plugin context the core expects, runs
 * the core, and registers the hooks it produces onto the OpenCode domains.
 *
 * See V2_PORT_PLAN.md for the remaining migration stages.
 */

import { createV1PluginContext } from "./plugin/opencode-context"
import { registerV1Hooks, type V1HooksLike } from "./plugin/opencode-hooks"
import type { Cleanup, V2Context, V2PluginDefinition } from "./plugin/opencode-types"
import { createMatrixxPlugin } from "./plugin/plugin-factory"
import { log } from "./shared"

async function setup(ctx: V2Context): Promise<Cleanup> {
  log("[matrixx] setup", {
    directory: ctx.location?.directory,
    opencode: ctx.app?.version,
  })

  const v1ctx = createV1PluginContext(ctx)
  const hooks = (await createMatrixxPlugin(v1ctx)) as unknown as V1HooksLike
  const bridge = await registerV1Hooks({
    ctx,
    hooks,
    directory: v1ctx.directory,
    worktree: v1ctx.worktree,
  })

  log("[matrixx] ready", { registrations: bridge.registrations.length })

  return async (): Promise<void> => {
    await bridge.dispose()
    log("[matrixx] disposed")
  }
}

export default {
  id: "matrixx",
  setup,
} satisfies V2PluginDefinition

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  MatrixxConfig,
  McpName,
} from "./config"

// NOTE: Do NOT export functions from the entrypoint!
// OpenCode treats ALL exports as plugin instances and calls them.
// Config error utilities are available via "./shared/config-errors" for internal use only.
export type { ConfigLoadError } from "./shared/config-errors"
