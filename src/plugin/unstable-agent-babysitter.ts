import type { MatrixxConfig } from "../config"
import type { BackgroundManager } from "../features/background-agent"

import { createUnstableAgentBabysitterHook } from "../hooks"
import type { NativePluginContext } from "../shared/session-context-source"

export function createUnstableAgentBabysitter(args: {
  ctx: NativePluginContext
  backgroundManager: BackgroundManager
  pluginConfig: MatrixxConfig
}) {
  const { ctx, backgroundManager, pluginConfig } = args

  return createUnstableAgentBabysitterHook(
    { session: ctx.session },
    {
      backgroundManager,
      config: pluginConfig.babysitting,
    },
  )
}
