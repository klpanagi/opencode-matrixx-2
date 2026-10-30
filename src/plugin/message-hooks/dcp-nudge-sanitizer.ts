/**
 * DCP sticky-nudge sanitizer — flat `Message[]` port (Task 26, Group C).
 *
 * Behavior parity with `src/hooks/dcp-nudge-sanitizer/hook.ts`: sweep every
 * message's `content` text blocks for DCP sticky-nudge markers, keep the first
 * one (sanitized + trimmed + compress-availability guard), drop the rest, cap
 * accumulation at ~1 per cycle. Non-text blocks are never touched. Operates on
 * the V2 flat shape (`role` + `content`); messages without an array `content`
 * are skipped without throwing.
 *
 * Ordering: Matrixx runs before DCP (plugin index 0 vs 1), so this sanitizer
 * cleans prior-cycle sticky nudges and caps accumulation at ~1/cycle. It cannot
 * suppress the nudge DCP injects later in the same cycle.
 */

import {
  guardCompressDirective,
  NUDGE_MARKERS,
  normalizeNudgeText,
} from "../../hooks/dcp-nudge-sanitizer/constants"
import { sanitizeKnownTags } from "../../shared/system-directive"
import type { MatrixxContext, V2Registration, V2SessionContextEvent } from "../context"

/** Minimal flat content block (text blocks carry `type: "text"` + `text`). */
export type FlatContentBlock = {
  readonly type?: unknown
  readonly text?: unknown
  [key: string]: unknown
}

/** Minimal flat message (`role` + `content`, never `{info, parts}`). */
export type FlatMessage = {
  role?: unknown
  content?: unknown
  [key: string]: unknown
}

function getTextBlock(block: unknown): { text: string } | null {
  if (typeof block !== "object" || block === null) return null
  const candidate = block as { type?: unknown; text?: unknown }
  if (candidate.type === "text" && typeof candidate.text === "string") {
    return { text: candidate.text }
  }
  return null
}

function isNudgeText(text: string): boolean {
  return NUDGE_MARKERS.some((marker) => {
    marker.lastIndex = 0
    return marker.test(text)
  })
}

/**
 * Dedupe + cap sticky nudges across the transcript in place: the first nudge
 * block is kept (sanitized, trimmed, guarded), every later one is removed.
 * Empty input is a no-op; blocks without an array `content` are skipped.
 */
export function sanitizeNudgeMessages(messages: FlatMessage[]): void {
  let keptNudge = false
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue
    const blocks = message.content
    if (!Array.isArray(blocks)) continue
    for (let i = 0; i < blocks.length; ) {
      const textBlock = getTextBlock(blocks[i])
      if (!textBlock || !isNudgeText(textBlock.text)) {
        i++
        continue
      }
      if (keptNudge) {
        blocks.splice(i, 1)
        continue
      }
      keptNudge = true
      // Known-tag handling routes via the shared closed-table helper; text-only,
      // no block add/remove/reorder here (the cap logic above owns that).
      ;(blocks[i] as { text: string }).text = guardCompressDirective(
        normalizeNudgeText(sanitizeKnownTags(textBlock.text, { control: "unwrap-keep-inner" })),
      )
      i++
    }
  }
}

/**
 * Native session-hook entry point: mutates `event.messages` in place.
 * A missing or non-array `messages` is a silent no-op (fail-open).
 */
export async function handleDcpNudgeSanitizerEvent(event: V2SessionContextEvent): Promise<void> {
  if (!Array.isArray(event.messages)) return
  sanitizeNudgeMessages(event.messages as FlatMessage[])
}

/**
 * Register the native entry point on every kind in its mapping-table row
 * (`dcpNudgeSanitizer` -> `context`).
 */
export async function registerDcpNudgeSanitizer(_ctx: MatrixxContext): Promise<V2Registration[]> {
  const registration = await _ctx.session.hook("context", async (event) => {
    await handleDcpNudgeSanitizerEvent(event)
  })
  return [registration]
}