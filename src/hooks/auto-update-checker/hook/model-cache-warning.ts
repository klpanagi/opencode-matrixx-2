import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"
import { isModelCacheAvailable } from "../../../shared/model-availability"
import { notify } from "../../../shared/notify"

export async function showModelCacheWarningIfNeeded(_ctx: PluginInput): Promise<void> {
  if (isModelCacheAvailable()) return

  notify("warn", "Model Cache Not Found: Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.")

  log("[auto-update-checker] Model cache warning shown")
}
