import type { MatrixxConfig } from "../../config"
import type { MatrixxContext } from "../../plugin/context"
import type { Hooks } from "../../plugin/legacy-hooks"
import { resolveContextModeEnforcement } from "../../shared/context-mode-enforcement"
import { notifyInjection } from "../../shared/injection-notifier"
import { buildContextModeRoutingBlock, containsContextModeMarker } from "./routing-block"

export const HOOK_NAME = "context-mode-routing"

/** Stable injector id for injection-notifier dedupe. */
export const CONTEXT_MODE_INJECTOR_ID = "context-mode-routing"

/** Short toast title for the context-mode routing-block injection. */
export const CONTEXT_MODE_NOTICE_TITLE = "Context injection"

/** Toast message — kept free of keyword-detector triggers (loop-safe). */
export const CONTEXT_MODE_NOTICE_MESSAGE = "Context guidance active"

/** Insert position: right after the first (primary) system message. */
const INSERT_INDEX = 1

type SystemTransformHandler = NonNullable<Hooks["experimental.chat.system.transform"]>

/**
 * Simple FNV-1a string hash (hex) used as the injection-content dedupe key.
 * Same content → same hash (toast suppressed); changed content → new toast.
 */
export function hashInjectionContent(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Builds the `experimental.chat.system.transform` handler that injects the
 * context-mode routing block into every system prompt.
 *
 * Fail-open by design: the hook is guidance, never enforcement, so any error
 * (malformed output, unexpected SDK shape) returns without throwing and simply
 * leaves the prompt untouched.
 *
 * When `ctx` is provided, a toast is fired via `notifyInjection` exactly once
 * per session per block version — only after the splice, never on the
 * marker-present early-return path. Dedupe is handled inside the notifier.
 */
export function createContextModeSystemTransformHook(pluginConfig: MatrixxConfig, ctx?: MatrixxContext): SystemTransformHandler {
  const { enabled } = resolveContextModeEnforcement(pluginConfig.context_mode)
  const routingBlock = buildContextModeRoutingBlock()
  const blockHash = hashInjectionContent(routingBlock)

  return async (input, output): Promise<void> => {
    try {
      if (!enabled) return
      // Title-generation and other session-less calls must not carry the block.
      if (!input?.sessionID) return
      if (!Array.isArray(output?.system)) return
      if (containsContextModeMarker(output.system)) return

      output.system.splice(Math.min(INSERT_INDEX, output.system.length), 0, routingBlock)
      if (ctx && input.sessionID) {
        await notifyInjection(ctx, {
          sessionID: input.sessionID,
          injector: CONTEXT_MODE_INJECTOR_ID,
          hash: blockHash,
          title: CONTEXT_MODE_NOTICE_TITLE,
          message: CONTEXT_MODE_NOTICE_MESSAGE,
        })
      }
    } catch {
      return
    }
  }
}
