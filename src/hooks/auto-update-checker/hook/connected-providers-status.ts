import type { PluginInput } from "@opencode-ai/plugin"
import {
  hasConnectedProvidersCache,
  updateConnectedProvidersCache,
} from "../../../shared/connected-providers-cache"
import { log } from "../../../shared/logger"
import { notify } from "../../../shared/notify"

export async function updateAndShowConnectedProvidersCacheStatus(ctx: PluginInput): Promise<void> {
  const hadCache = hasConnectedProvidersCache()

  updateConnectedProvidersCache(ctx.client).catch((err) => { log("[auto-update] Provider cache update failed:", err) })

  if (!hadCache) {
    notify("info", "Connected Providers Cache: Building provider cache for first time. Restart OpenCode for full model filtering.")

    log("[auto-update-checker] Connected providers cache toast shown (first run)")
  } else {
    log("[auto-update-checker] Connected providers cache exists, updating in background")
  }
}
