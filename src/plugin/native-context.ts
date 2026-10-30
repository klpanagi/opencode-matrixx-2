import { $ } from "bun"
import type { NativePluginContext } from "../shared/session-context-source"
import type { V2Context } from "./opencode-types"

/**
 * Builds the native plugin context the matrixx core runs against.
 *
 * The V2 plugin runs in-process, so there is no HTTP client to inject:
 * `session`/`agent`/`model` are the live V2 domains and every consumer
 * reads them through `SessionContextCarrier` / `NativeDomains`. The token
 * no longer travels over HTTP, which is why `injectServerAuthIntoClient`
 * has no native twin.
 */
export function createNativePluginContext(ctx: V2Context): NativePluginContext {
  const directory = ctx.location?.directory ?? process.cwd()
  const canonical = ctx.location?.project?.canonical
  const worktree = canonical && canonical.length > 0 ? canonical : directory
  const now = Date.now()

  return {
    session: ctx.session,
    agent: ctx.agent,
    model: ctx.model,
    project: {
      id: ctx.location?.project?.id ?? "matrixx",
      worktree,
      vcs: "git",
      time: { created: now, updated: now },
    },
    directory,
    worktree,
    $,
  } as unknown as NativePluginContext
}
