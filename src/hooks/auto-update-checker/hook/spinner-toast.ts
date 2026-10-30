import type { PluginInput } from "@opencode-ai/plugin"
import { notify } from "../../../shared/notify"

export async function showSpinnerToast(_ctx: PluginInput, version: string, message: string): Promise<void> {
  notify("info", `Matrixx ${version}: ${message}`)
}
