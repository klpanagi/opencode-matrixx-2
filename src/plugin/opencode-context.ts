/**
 * V2 → V1 context translation.
 *
 * The existing matrixx core expects the V1 `PluginInput` shape
 * (`{ client, project, directory, worktree, serverUrl, $ }`). This module builds
 * that shape from the V2 plugin context so the untouched core can run.
 */

import { $ } from "bun"
import type { ListDomain, NativePluginContext, SessionDomainLike } from "../shared/session-context-source"
import { createClientShim } from "./opencode-client"
import type { V2Context } from "./opencode-types"
import type { PluginContext } from "./types"

export interface V1ContextView {
  client: PluginContext["client"]
  session: SessionDomainLike
  agent: ListDomain
  model: ListDomain
  project: unknown
  directory: string
  worktree: string
  serverUrl: URL
  $: PluginContext["$"]
}

/**
 * Builds the V1 `PluginInput` the matrixx core is written against.
 *
 * `directory`/`worktree` come from the V2 location; the HTTP client is replaced
 * by the in-process shim; `$` is the Bun shell the plugin runtime provides.
 */
export function createV1PluginContext(ctx: V2Context): NativePluginContext {
  const location = ctx.location
  const directory = location?.directory ?? process.cwd()
  const canonical = location?.project?.canonical
  const worktree = canonical && canonical.length > 0 ? canonical : directory
  const now = Date.now()

  const view: V1ContextView = {
    client: createClientShim(ctx) as unknown as PluginContext["client"],
    session: ctx.session,
    agent: ctx.agent,
    model: ctx.model,
    project: {
      id: location?.project?.id ?? "matrixx",
      worktree,
      vcs: "git",
      time: { created: now, updated: now },
    },
    directory,
    worktree,
    serverUrl: new URL("http://127.0.0.1"),
    $,
  }

  return view as unknown as NativePluginContext
}
