/**
 * Matrixx — OpenCode plugin entrypoint.
 *
 * V2-native `{ id, setup }` shape (packages/core/src/plugin/module.ts
 * decodes the default export against `{ id, effect } | { id, setup }`).
 * `setup` delegates to the domain setup functions in
 * `./plugin/setup-domains`, which build `Hooks` fragments directly and
 * register them onto the V2 context — no factory, no bridge in between.
 *
 * NOTE: the host validates the default export structurally
 * (`{ id, setup }`), so no `definePlugin` helper is needed.
 */

import type { Cleanup, MatrixxContext } from "./plugin/context"
import { registerDomains, setupDomains } from "./plugin/setup-domains"
import { log } from "./shared"

async function setup(ctx: MatrixxContext): Promise<Cleanup> {
  log("[matrixx] setup", {
    directory: ctx.location?.directory,
    opencode: ctx.app?.version,
  })

  const { hooks, directory, worktree } = await setupDomains(ctx)
  const bridge = await registerDomains({ ctx, hooks, directory, worktree })

  log("[matrixx] ready", { registrations: bridge.registrations.length })

  return async (): Promise<void> => {
    await bridge.dispose()
    log("[matrixx] disposed")
  }
}

export default {
  id: "matrixx",
  setup,
}

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
