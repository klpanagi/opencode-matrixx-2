import type { MatrixxConfig, TmuxConfig } from "../../config"
import { initTaskToastManager } from "../../features/task-toast-manager"
import { createModelCacheState } from "../../plugin-state"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { createConfigHandler } from "../handlers"

/** Managers owned by the composition root (moved from `create-managers.ts`). */
export type DomainManagers = {
  configHandler: ReturnType<typeof createConfigHandler>
}

export function createDomainManagers(args: {
  ctx: NativePluginContext
  pluginConfig: MatrixxConfig
  tmuxConfig: TmuxConfig
}): DomainManagers {
  // Phase 5: no custom task manager. Native session/background APIs own subagent
  // lifecycle and display — no TmuxSessionManager, no pane mirror, no custom
  // reconcile loops. `tmuxConfig` is accepted for signature compatibility
  // only (interactive-bash + doctor read it separately).
  const { ctx, pluginConfig } = args
  void args.tmuxConfig

  initTaskToastManager()

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory },
    pluginConfig,
    modelCacheState: createModelCacheState(),
  })

  return {
    configHandler,
  }
}
