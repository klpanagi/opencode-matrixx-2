import type { MatrixxContext } from "../../../plugin/tool/context"
import { isModelCacheAvailable } from "../../../shared/model/model-availability"
import { log } from "../../../shared/runtime/logger"
import { notify } from "../../../shared/runtime/notify"

export async function showModelCacheWarningIfNeeded(_ctx: MatrixxContext): Promise<void> {
  if (isModelCacheAvailable()) return

  notify("warn", "Model Cache Not Found: Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.")

  log("[auto-update-checker] Model cache warning shown")
}
