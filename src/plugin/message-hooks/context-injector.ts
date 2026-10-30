import { type ContextCollector, contextCollector } from "../../features/context-injector"
import { getMainSessionID } from "../../features/session-state/state"
import { log } from "../../shared/logger"
import { roleOf, type SessionMessage } from "../../shared/session-message"
import type { MatrixxContext, V2Registration } from "../context"

export interface FlatMessageHookEvent {
  readonly sessionID: string
  messages: SessionMessage[]
}

export interface ContextInjectorDeps {
  collector?: ContextCollector
}

export async function applyContextInjectorMessagesTransform(
  event: FlatMessageHookEvent,
  deps: ContextInjectorDeps = {},
): Promise<void> {
  const messages = event?.messages
  log("[DEBUG] session.hook(context/compaction) called", {
    messageCount: messages?.length ?? 0,
  })
  if (!messages || messages.length === 0) {
    return
  }

  let lastUserMessageIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") {
      lastUserMessageIndex = i
      break
    }
  }

  if (lastUserMessageIndex === -1) {
    log("[DEBUG] No user message found in messages")
    return
  }

  const sessionID = event.sessionID ?? getMainSessionID()
  if (!sessionID) {
    log("[DEBUG] sessionID is undefined (both event.sessionID and mainSessionID are empty)")
    return
  }

  const collector = deps.collector ?? contextCollector
  if (!collector.hasPending(sessionID)) {
    return
  }

  const pending = collector.consume(sessionID)
  if (!pending.hasContent) {
    return
  }

  const lastUserMessage = messages[lastUserMessageIndex]
  if (typeof lastUserMessage.text !== "string") {
    log("[context-injector] No text found in last user message, skipping injection", {
      sessionID,
    })
    return
  }

  lastUserMessage.text = `${pending.merged}\n\n---\n\n${lastUserMessage.text}`

  log("[context-injector] Inserted pending context into last user message", {
    sessionID,
    contentLength: pending.merged.length,
  })
}

export async function registerContextInjectorMessagesTransform(
  ctx: MatrixxContext,
  deps: ContextInjectorDeps = {},
): Promise<V2Registration[]> {
  const callback = async (event: { sessionID: string; messages: SessionMessage[] }): Promise<void> => {
    await applyContextInjectorMessagesTransform(event, deps)
  }
  const onContext = await ctx.session.hook("context", async (event) => {
    await callback({ sessionID: event.sessionID, messages: event.messages as SessionMessage[] })
  })
  const onCompaction = await ctx.session.hook("compaction", async (event) => {
    await callback({ sessionID: event.sessionID, messages: event.messages as SessionMessage[] })
  })
  return [onContext, onCompaction]
}
