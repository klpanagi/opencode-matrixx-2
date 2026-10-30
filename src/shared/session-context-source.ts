/**
 * Native session-context access for message reads.
 *
 * V2's `context()` may answer with either a bare message array or a `{ messages }`
 * object, so every read goes through `fetchSessionMessages` instead of call sites
 * guessing the shape. Rejections propagate: callers that degrade on failure keep
 * their existing `.catch(...)` handling.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import type { SessionDomainLike } from "./session-facade"
import type { SessionMessage } from "./session-message"

export type { SessionDomainLike }

export interface SessionContextDomain {
  context(input: { sessionID: string }): Promise<unknown>
}

export type SessionContextCarrier = { session: SessionContextDomain }

export interface ListDomain {
  list(): Promise<unknown>
}

export type NativeDomains = {
  session: SessionDomainLike
  agent: ListDomain
  model: ListDomain
}

export type NativePluginContext = PluginInput & NativeDomains

export type NativeContext = {
  session: SessionContextDomain
  agent: ListDomain
  model: ListDomain
}

export function messagesOf(raw: unknown): SessionMessage[] {
  if (Array.isArray(raw)) return raw as SessionMessage[]
  const messages = (raw as { messages?: unknown } | null | undefined)?.messages
  return Array.isArray(messages) ? (messages as SessionMessage[]) : []
}

export async function fetchSessionMessages(
  carrier: SessionContextCarrier,
  sessionID: string,
): Promise<SessionMessage[]> {
  return messagesOf(await carrier.session.context({ sessionID }))
}
