import type { PluginInput } from "@opencode-ai/plugin"
import { clearConfigLoadErrors, getConfigLoadErrors } from "../../../shared/config-errors"
import { log } from "../../../shared/logger"
import { notify } from "../../../shared/notify"

export async function showConfigErrorsIfAny(_ctx: PluginInput): Promise<void> {
  const errors = getConfigLoadErrors()
  if (errors.length === 0) return

  const errorMessages = errors.map((error: { path: string; error: string }) => `${error.path}: ${error.error}`).join("\n")
  notify("error", `Config Load Error: Failed to load config:\n${errorMessages}`)

  log(`[auto-update-checker] Config load errors shown: ${errors.length} error(s)`) 
  clearConfigLoadErrors()
}
