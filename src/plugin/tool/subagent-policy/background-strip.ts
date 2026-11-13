import { log } from "../../../shared/runtime/logger"

export const BACKGROUND_KEYS = ["background", "run_in_background"] as const

export type BackgroundStripLogFn = (message: string, data?: unknown) => void

export function stripBackgroundArgs(
  args: Record<string, unknown>,
  logFn: BackgroundStripLogFn = log,
): string[] {
  const stripped: string[] = []
  for (const key of BACKGROUND_KEYS) {
    if (!Object.hasOwn(args, key)) continue
    if (!Reflect.deleteProperty(args, key)) continue
    stripped.push(key)
    logFn("[subagent-policy] stripped background affordance", { key })
  }
  return stripped
}
