/**
 * Native `session.hook("context"|"compaction")` registration for the
 * `envContextInjector` mapping-table row (Task 27).
 *
 * Thin registration wrapper: delegates to the Task 26 flat-`Message[]` port
 * (`applyEnvContextInjector` in `src/hooks/env-context-injector/flat.ts`).
 * Same targets (`context`, `compaction`), same call shape, no behavior change.
 */

import { applyEnvContextInjector } from "../../hooks/env-context-injector/flat"
import type { MatrixxContext, V2Registration } from "../context"

/**
 * Register the flat port on every native kind in its mapping-table row
 * (`envContextInjector` -> `context`, `compaction`).
 */
export async function registerEnvContextInjector(ctx: MatrixxContext): Promise<V2Registration[]> {
  const registrations: V2Registration[] = []
  for (const kind of ["context", "compaction"] as const) {
    registrations.push(
      await ctx.session.hook(kind, async (event) => {
        await applyEnvContextInjector(
          { sessionID: event.sessionID, messages: event.messages, system: event.system },
          ctx,
        )
      }),
    )
  }
  return registrations
}
