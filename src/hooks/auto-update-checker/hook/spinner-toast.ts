import type { MatrixxContext } from "../../../plugin/context"
import { notify } from "../../../shared/notify"

export async function showSpinnerToast(_ctx: MatrixxContext, version: string, message: string): Promise<void> {
  notify("info", `Matrixx ${version}: ${message}`)
}
