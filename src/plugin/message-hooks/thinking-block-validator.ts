/**
 * Native `session.hook("context"|"generate")` registration for the
 * `thinkingBlockValidator` mapping-table row (Task 27).
 *
 * Thin registration wrapper: delegates to the Task 26 flat-`Message[]` port
 * (`applyThinkingBlockValidator` in `src/hooks/thinking-block-validator/flat.ts`).
 * Same targets (`context`, `generate`), same call shape, no behavior change.
 * `generate` coverage matters because auxiliary requests bypass `context`.
 */

import { applyThinkingBlockValidator } from "../../hooks/thinking-block-validator/flat"
import type { MatrixxContext, V2Registration } from "../context"

/**
 * Register the flat port on every native kind in its mapping-table row
 * (`thinkingBlockValidator` -> `context`, `generate`).
 */
export async function registerThinkingBlockValidator(ctx: MatrixxContext): Promise<V2Registration[]> {
  const registrations: V2Registration[] = []
  for (const kind of ["context", "generate"] as const) {
    registrations.push(
      await ctx.session.hook(kind, async (event) => {
        await applyThinkingBlockValidator({
          sessionID: event.sessionID,
          messages: event.messages,
          model: event.model,
        })
      }),
    )
  }
  return registrations
}
