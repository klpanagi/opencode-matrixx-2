import type { MatrixxContext } from "../../../plugin/context"
import { log } from "../../../shared/logger"
import { isModelCacheAvailable } from "../../../shared/model-availability"
import { notify } from "../../../shared/notify"

export async function showModelCacheWarningIfNeeded(_ctx: MatrixxContext): Promise<void> {
  if (isModelCacheAvailable()) return

  notify("warn", "Model Cache Not Found: Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.")

  log("[auto-update-checker] Model cache warning shown")
}
