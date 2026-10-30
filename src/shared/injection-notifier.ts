import type { MatrixxContext } from "../plugin/context"
import { log } from "./logger"
import { createSystemDirective } from "./system-directive"

export const INJECTION_NOTICE_MAX_BODY_LENGTH = 120

export interface NotifyInjectionOptions {
  sessionID: string
  injector: string
  hash: string
  title: string
  message: string
  /** Opt-in persistent mirror via session.prompt({ noReply: true }). Default: false (toast-only). Wire to `notification.injection_notices.persistent` — callers pass the resolved flag (config-as-param convention, cf. agent-variant.ts). */
  persistent?: boolean
}

const lastKeyBySession = new Map<string, string>()

export function resetInjectionNotifier(): void {
  lastKeyBySession.clear()
}

export function buildInjectionNotice(message: string): string {
  const prefix = `${createSystemDirective("INJECTION NOTICE")} `
  const budget = INJECTION_NOTICE_MAX_BODY_LENGTH - prefix.length
  const body = message.length > budget ? message.slice(0, budget) : message
  return `${prefix}${body}`
}

export async function notifyInjection(ctx: MatrixxContext, options: NotifyInjectionOptions): Promise<void> {
  try {
    const key = `${options.injector}:${options.hash}`
    if (lastKeyBySession.get(options.sessionID) === key) return
    lastKeyBySession.set(options.sessionID, key)
    const notice = buildInjectionNotice(options.message)
    const tui = (ctx as unknown as { client?: { tui?: { showToast?: (opts: unknown) => Promise<unknown> } } }).client?.tui
    if (tui?.showToast) {
      await tui
        .showToast({
          body: {
            title: options.title,
            message: notice,
            variant: "info" as const,
            duration: 3000,
          },
        })
        .catch((err) => log(`[injection-notifier] Failed to show toast`, { error: err, sessionID: options.sessionID }))
    }
    if (options.persistent === true) {
      try {
        const session = (ctx as unknown as { client?: { session?: { prompt?: (args: unknown) => Promise<unknown> } } }).client?.session
        if (typeof session?.prompt !== "function") return
        await (session.prompt({ parts: [{ type: "text", text: notice }], noReply: true }) as Promise<unknown>).catch((err) =>
          log(`[injection-notifier] Failed to send persistent notice`, { error: err, sessionID: options.sessionID })
        )
      } catch (err) {
        log(`[injection-notifier] persistent notify failed fail-open`, { error: err })
      }
    }
  } catch (err) {
    log(`[injection-notifier] notify failed fail-open`, { error: err })
  }
}
