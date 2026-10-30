/**
 * Native `session.hook("context")` port of the `domainKeywordDetector`
 * `experimental.chat.messages.transform` hook (Task 26, Group A).
 *
 * Flat-`Message[]` twin of `src/hooks/domain-keyword-detector/hook.ts`:
 * same scan (last user message text), same guards (idempotency marker,
 * system-directive skip, tag sanitization), same splice
 * (`hint + "\n\n---\n\n" + original`), same notify. The only shape change
 * is V1 `{ info, parts }[]` -> flat `SessionMessage[]` (role is `.type`,
 * user text is `.text`), and the session ID comes from the native event
 * instead of `message.info.sessionID`.
 */

import { getMainSessionID } from "../../features/session-state/state"
import { DOMAIN_HINT_MARKER } from "../../hooks/domain-keyword-detector/constants"
import { buildDomainHint, detectDomainSkills } from "../../hooks/domain-keyword-detector/detector"
import { log, notifyInjection } from "../../shared"
import { roleOf, type SessionMessage } from "../../shared/session-message"
import { isSystemDirective, sanitizeKnownTags } from "../../shared/system-directive"
import type { MatrixxContext, V2Registration } from "../context"

/** Minimal flat-message view of the native context/compaction event. */
export interface FlatMessageHookEvent {
  readonly sessionID: string
  messages: SessionMessage[]
}

/**
 * Scan the last user message for finance-domain keywords and prepend the
 * compact skill hint. Mutates `event.messages` in place; no-op when there
 * is no user message, no keyword match, or the hint is already present.
 */
export async function applyDomainKeywordDetector(
  event: FlatMessageHookEvent,
  ctx?: MatrixxContext,
): Promise<void> {
  const messages = event?.messages
  if (!messages || messages.length === 0) return

  let lastUserMessage: SessionMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") {
      lastUserMessage = messages[i]
      break
    }
  }
  if (!lastUserMessage) return

  const originalText = typeof lastUserMessage.text === "string" ? lastUserMessage.text : ""
  if (originalText.length === 0) return
  if (originalText.includes(DOMAIN_HINT_MARKER)) return
  if (isSystemDirective(originalText)) return

  const cleanText = sanitizeKnownTags(originalText, { presentation: "drop" })
  const skills = detectDomainSkills(cleanText)
  if (skills.length === 0) return

  lastUserMessage.text = `${buildDomainHint(skills)}\n\n---\n\n${originalText}`

  log("[domain-keyword-detector] Injected domain skills", { skills })

  const sessionID = event.sessionID ?? getMainSessionID()
  if (ctx && sessionID) {
    await notifyInjection(ctx, {
      sessionID,
      injector: "domain-keyword-detector",
      hash: skills.join(","),
      title: "Context injection",
      message: "Domain hint applied",
    })
  }
}

/**
 * Register the flat port on every native kind in its mapping-table row
 * (`domainKeywordDetector` -> `context`).
 */
export async function registerDomainKeywordDetector(ctx: MatrixxContext): Promise<V2Registration[]> {
  const registration = await ctx.session.hook("context", async (event) => {
    await applyDomainKeywordDetector(
      { sessionID: event.sessionID, messages: event.messages as SessionMessage[] },
      ctx,
    )
  })
  return [registration]
}
