/**
 * Native `session.hook("context")` registration for the `evolutionHitl`
 * mapping-table row (Task 27).
 *
 * Thin registration wrapper: delegates to the Task 26 flat-`Message[]` port
 * (`applyEvolutionHitl` in `src/hooks/evolution-hitl/flat.ts`). Same target
 * (`context`), same call shape (config + deps passthrough), no behavior change.
 */

import { applyEvolutionHitl, type EvolutionHitlDeps } from "../../hooks/evolution-hitl/flat"
import type { MatrixxContext, V2Registration } from "../context"

/**
 * Register the flat port on every native kind in its mapping-table row
 * (`evolutionHitl` -> `context`).
 */
export async function registerEvolutionHitl(
  ctx: MatrixxContext,
  deps?: EvolutionHitlDeps & { config?: unknown },
): Promise<V2Registration[]> {
  const registration = await ctx.session.hook("context", async (event) => {
    await applyEvolutionHitl(
      { sessionID: event.sessionID, messages: event.messages },
      deps?.config,
      undefined,
      deps,
    )
  })
  return [registration]
}
