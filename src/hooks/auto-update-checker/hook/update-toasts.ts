import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"
import { notify } from "../../../shared/notify"

export async function showUpdateAvailableToast(
  _ctx: PluginInput,
  latestVersion: string,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  notify("info", `Matrixx ${latestVersion}: ${getToastMessage(true, latestVersion)}`)
  log(`[auto-update-checker] Update available toast shown: v${latestVersion}`)
}

export async function showAutoUpdatedToast(_ctx: PluginInput, oldVersion: string, newVersion: string): Promise<void> {
  notify("success", `Matrixx Updated!: v${oldVersion} → v${newVersion}\nRestart OpenCode to apply.`)
  log(`[auto-update-checker] Auto-updated toast shown: v${oldVersion} → v${newVersion}`)
}
