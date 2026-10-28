import type { MatrixxConfig } from "../config"
import type { BackgroundManager } from "../features/background-agent"

import { createUnstableAgentBabysitterHook } from "../hooks"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "../shared/model-suggestion-retry"
import { isRecord } from "../shared/record-type-guard"
import type { PluginContext } from "./types"

export function createUnstableAgentBabysitter(args: {
  ctx: PluginContext
  backgroundManager: BackgroundManager
  pluginConfig: MatrixxConfig
}) {
  const { ctx, backgroundManager, pluginConfig } = args

  return createUnstableAgentBabysitterHook(
    {
      directory: ctx.directory,
      client: {
        session: {
          messages: async ({ path }) => {
            const result = await ctx.client.session.messages({ path })
            if (Array.isArray(result)) return result
            if (isRecord(result)) {
              return result
            }
            return []
          },
          prompt: async (promptArgs) => {
            await promptSyncWithModelSuggestionRetry(
              ctx.client,
              promptArgs as unknown as Parameters<typeof promptSyncWithModelSuggestionRetry>[1],
            )
          },
          promptAsync: async (promptArgs) => {
            await promptWithModelSuggestionRetry(
              ctx.client,
              promptArgs as unknown as Parameters<typeof promptWithModelSuggestionRetry>[1],
            )
          },
        },
      },
    },
    {
      backgroundManager,
      config: pluginConfig.babysitting,
    },
  )
}
