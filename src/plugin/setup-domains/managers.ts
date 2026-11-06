import type { MatrixxConfig, TmuxConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import { BackgroundManager as BackgroundManagerImpl } from "../../features/background-agent"
import { initTaskToastManager } from "../../features/task-toast-manager"
import { createModelCacheState } from "../../plugin-state"
import { log } from "../../shared"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { createConfigHandler } from "../handlers"

/** Managers owned by the composition root (moved from `create-managers.ts`). */
export type DomainManagers = {
  backgroundManager: BackgroundManager
  configHandler: ReturnType<typeof createConfigHandler>
}

export function createDomainManagers(args: {
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

  initTaskToastManager()

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory },
    pluginConfig,
    modelCacheState: createModelCacheState(),
  })

  return {
    backgroundManager,
    configHandler,
  }
}
