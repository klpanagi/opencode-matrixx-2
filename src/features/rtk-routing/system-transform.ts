import type { MatrixxConfig } from "../../config"
import type { MatrixxContext } from "../../plugin/context"
import type { Hooks } from "../../plugin/legacy-hooks"
import { getAvailableToolNames } from "../../plugin-handlers/agent-config-handler"
import { notifyInjection } from "../../shared/injection-notifier"
import { resolveRtkEnforcement } from "../../shared/rtk-enforcement"
import { isShellTool } from "../../shared/shell-tool-name"
import { buildRtkRoutingBlock, containsRtkMarker } from "./routing-block"

export const HOOK_NAME = "rtk-routing"

/** Stable injector id for injection-notifier dedupe. */
export const RTK_INJECTOR_ID = "rtk-routing"

/** Short toast title for the RTK routing-block injection. */
export const RTK_NOTICE_TITLE = "RTK injection"

/** Toast message — kept free of keyword-detector triggers (loop-safe). */
export const RTK_NOTICE_MESSAGE = "RTK discipline active"

/** Insert position: right after the first (primary) system message. */
const INSERT_INDEX = 1

type SystemTransformHandler = NonNullable<Hooks["experimental.chat.system.transform"]>

export interface RtkSystemTransformOptions {
  hookEnabled?: boolean
  hasBash?: (agentName?: string) => boolean
  which?: (binary: string) => string | null
}

/**
 * Simple FNV-1a string hash (hex) used as the injection-content dedupe key.
 * Same content → same hash (toast suppressed); changed content → new toast.
 */
export function hashRtkInjectionContent(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Default shell probe backed by the single existing available-tool-names
 * signal (set once at startup by index.ts via setAvailableToolNames).
 * Suppresses only when affirmatively known to lack shell: a non-empty
 * registry without "bash"/"shell" means no agent can run shell commands, so
 * the discipline block is noise. An empty registry means identity/tooling is
 * unknown — default to INJECT in that case.
 */
function defaultHasBash(): boolean {
  const names = getAvailableToolNames()
  if (names.length === 0) return true
  return names.some(isShellTool)
}

/**
 * Builds the `experimental.chat.system.transform` handler that injects the
 * RTK shell-discipline routing block into every system prompt.
 *
 * Fail-open by design: the hook is guidance, never enforcement, so any error
 * (malformed output, unexpected SDK shape) returns without throwing and
 * simply leaves the prompt untouched.
 *
 * Seams (test-only overrides, never production paths):
 * - `which` — injected binary probe, forwarded to the resolver so tests can
 *   simulate a present binary without touching PATH.
 * - `hookEnabled` — captured at factory time alongside the resolver result;
 *   lets tests flip the gate without touching hook config.
 * - `hasBash` — per-agent bash probe; receives the agent name when the
 *   caller knows it, defaults to the global available-tool-names signal.
 *
 * When `ctx` is provided, a toast is fired via `notifyInjection` exactly once
 * per session per block version — only after the splice, never on the
 * marker-present early-return path. Dedupe is handled inside the notifier.
 */
export function createRtkSystemTransformHook(
  pluginConfig: MatrixxConfig,
  opts?: RtkSystemTransformOptions,
  ctx?: MatrixxContext,
): SystemTransformHandler {
  const { active } = resolveRtkEnforcement(pluginConfig.rtk, {
    hookEnabled: opts?.hookEnabled,
    which: opts?.which,
  })
  const routingBlock = buildRtkRoutingBlock()
  const blockHash = hashRtkInjectionContent(routingBlock)
  const hasBash = opts?.hasBash ?? defaultHasBash

  return async (input, output): Promise<void> => {
    try {
      if (!active) return
      // Title-generation and other session-less calls must not carry the block.
      if (!input?.sessionID) return
      if (!Array.isArray(output?.system)) return
      if (containsRtkMarker(output.system)) return
      // Per-agent suppression: skip agents affirmatively known to lack bash.
      if (!hasBash()) return

      output.system.splice(Math.min(INSERT_INDEX, output.system.length), 0, routingBlock)
      if (ctx && input.sessionID) {
        await notifyInjection(ctx, {
          sessionID: input.sessionID,
          injector: RTK_INJECTOR_ID,
          hash: blockHash,
          title: RTK_NOTICE_TITLE,
          message: RTK_NOTICE_MESSAGE,
        })
      }
    } catch {
      return
    }
  }
}
