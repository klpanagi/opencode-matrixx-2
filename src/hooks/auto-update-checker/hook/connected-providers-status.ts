import type { MatrixxContext } from "../../../plugin/context"
import {
  hasConnectedProvidersCache,
  updateConnectedProvidersCache,
} from "../../../shared/model/connected-providers-cache"
import { log } from "../../../shared/runtime/logger"
import { notify } from "../../../shared/runtime/notify"

export async function updateAndShowConnectedProvidersCacheStatus(_ctx: MatrixxContext): Promise<void> {
  const hadCache = hasConnectedProvidersCache()

  updateConnectedProvidersCache().catch((err) => { log("[auto-update] Provider cache update failed:", err) })

  if (!hadCache) {
    notify("info", "Connected Providers Cache: Building provider cache for first time. Restart OpenCode for full model filtering.")

    log("[auto-update-checker] Connected providers cache toast shown (first run)")
  } else {
    log("[auto-update-checker] Connected providers cache exists, updating in background")
  }
}
