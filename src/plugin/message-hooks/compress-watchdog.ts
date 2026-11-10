/**
 * Compress watchdog — native session hook.
 *
 * Registers one `session.hook("context")` callback and, when the configured
 * usage ceiling is crossed, prepends an explicit compress directive to the tail
 * of the last user message. Tail injection preserves the prompt-cache prefix;
 * the system prompt is never touched.
 *
 * Fail-open everywhere: an unknown model window, a missing token figure, a
 * subagent session, or a missing `compress` tool all skip silently instead of
 * injecting an instruction the model cannot satisfy.
 */

import { getParentSessionID, subagentSessions } from "../../features/session-state/state"
import {
  buildCompressDirective,
  COMPRESS_WATCHDOG_MARKER,
  type CompressWatchdogConfigInput,
  extractContextUsage,
  resolveCompressWatchdogConfig,
  resolveContextLimit,
  shouldInjectCompressDirective,
  usagePercent,
} from "../../shared/policy/compress-watchdog"
import {
  type KeywordCompressTriggerConfigInput,
  resolveKeywordCompressTriggerConfig,
  shouldInjectForKeyword,
} from "../../shared/policy/keyword-compress-trigger"
import { log } from "../../shared/runtime/logger"
import { roleOf, type SessionMessage } from "../../shared/session/session-message"
import type { MatrixxContext, V2Registration, V2SessionContextEvent } from "../tool/context"

const MODEL_LIST_TTL_MS = 60_000
const MAX_TRACKED_SESSIONS = 500

export interface CompressWatchdogOptions {
  config?: CompressWatchdogConfigInput | undefined
  keywordTrigger?: KeywordCompressTriggerConfigInput | undefined
  hookEnabled?: boolean | undefined
  now?: (() => number) | undefined
}

export interface LastUserMessage {
  index: number
  text: string
}

/** Newest user message that carries text, or `null` when there is none. */
export function findLastUserMessage(messages: readonly unknown[]): LastUserMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as SessionMessage | undefined
    if (!message || roleOf(message) !== "user") continue
    if (typeof message.text !== "string" || message.text.length === 0) return null
    return { index, text: message.text }
  }
  return null
}

export interface SessionWatchState {
  turns: number
  lastInjectedTurn: number | null
}

export function turnsSinceLastInjection(state: SessionWatchState): number {
  if (state.lastInjectedTurn === null) return Number.POSITIVE_INFINITY
  return state.turns - state.lastInjectedTurn
}

function isSubagentSession(sessionID: string): boolean {
  return subagentSessions.has(sessionID) || getParentSessionID(sessionID) !== undefined
}

function hasCompressTool(event: V2SessionContextEvent): boolean {
  const tools = event.tools
  return typeof tools === "object" && tools !== null && "compress" in tools
}

async function readSessionUsage(
  ctx: MatrixxContext,
  event: V2SessionContextEvent,
  messages: readonly unknown[],
) {
  const fromEvent = extractContextUsage(messages)
  if (fromEvent) return fromEvent
  try {
    const raw = await ctx.session.context({ sessionID: event.sessionID })
    if (Array.isArray(raw)) return extractContextUsage(raw)
    const nested = (raw as { messages?: unknown })?.messages
    return Array.isArray(nested) ? extractContextUsage(nested) : null
  } catch (error) {
    log("[compress-watchdog] session context read failed", {
      sessionID: event.sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Register the watchdog. Returns an empty list when disabled or when the
 * `compress-watchdog` hook name is in `disabled_hooks`.
 */
export async function registerCompressWatchdog(
  ctx: MatrixxContext,
  options: CompressWatchdogOptions = {},
): Promise<V2Registration[]> {
  const config = resolveCompressWatchdogConfig(options.config)
  const keywordTrigger = resolveKeywordCompressTriggerConfig(options.keywordTrigger)
  if (!config.enabled || options.hookEnabled === false) return []

  const now = options.now ?? (() => Date.now())
  const sessions = new Map<string, SessionWatchState>()
  let limitsCache: { fetchedAt: number; raw: unknown } | null = null

  async function loadModelList(force: boolean): Promise<unknown> {
    const fetchedAt = now()
    if (!force && limitsCache && fetchedAt - limitsCache.fetchedAt < MODEL_LIST_TTL_MS) {
      return limitsCache.raw
    }
    try {
      const raw = await ctx.model.list()
      limitsCache = { fetchedAt, raw }
      return raw
    } catch (error) {
      log("[compress-watchdog] model list read failed", {
        error: error instanceof Error ? error.message : String(error),
      })
      return limitsCache?.raw ?? null
    }
  }

  const registration = await ctx.session.hook("context", async (event) => {
    try {
      if (!config.enabled) return
      if (isSubagentSession(event.sessionID)) return
      if (!hasCompressTool(event)) return

      const state = sessions.get(event.sessionID) ?? { turns: 0, lastInjectedTurn: null }
      state.turns += 1
      sessions.set(event.sessionID, state)
      if (sessions.size > MAX_TRACKED_SESSIONS) {
        const oldest = sessions.keys().next().value
        if (oldest !== undefined) sessions.delete(oldest)
      }

      const rawMessages = Array.isArray(event.messages) ? event.messages : []
      const usage = await readSessionUsage(ctx, event, rawMessages)
      if (!usage) return

      let limit = resolveContextLimit(
        await loadModelList(false),
        usage.providerID,
        usage.modelID,
      )
      if (limit === null) {
        limit = resolveContextLimit(await loadModelList(true), usage.providerID, usage.modelID)
      }
      if (limit === null) return

      const currentPercent = usagePercent(usage.tokens, limit)
      const lastUser = findLastUserMessage(rawMessages)
      const shouldInject = shouldInjectCompressDirective({
        config,
        currentPercent,
        turnsSinceLastInjection: turnsSinceLastInjection(state),
        lastUserText: lastUser?.text,
      })
      if (shouldInject && lastUser) {
        const target = rawMessages[lastUser.index] as SessionMessage
        if (typeof target.text !== "string") return
        const directive = buildCompressDirective({
          currentPercent,
          tokens: usage.tokens,
          limit,
          config,
        })
        target.text = `${directive}\n\n---\n\n${target.text}`
        state.lastInjectedTurn = state.turns

        log("[compress-watchdog] directive injected", {
          sessionID: event.sessionID,
          currentPercent: Number(currentPercent.toFixed(1)),
          abovePercent: config.abovePercent,
          targetPercent: config.targetPercent,
          tokens: usage.tokens,
          limit,
        })
      } else if (
        lastUser &&
        shouldInjectForKeyword({
          config: keywordTrigger,
          lastUserText: lastUser.text,
          turnsSinceLastInjection: turnsSinceLastInjection(state),
          cooldownTurns: config.cooldownTurns,
        })
      ) {
        const target = rawMessages[lastUser.index] as SessionMessage
        if (typeof target.text !== "string") return
        const directive = buildCompressDirective({
          currentPercent,
          tokens: usage.tokens,
          limit,
          config,
        })
        target.text = `${directive}\n\n---\n\n${target.text}`
        state.lastInjectedTurn = state.turns

        log("[compress-watchdog] keyword trigger injected", {
          sessionID: event.sessionID,
          currentPercent: Number(currentPercent.toFixed(1)),
          abovePercent: config.abovePercent,
          targetPercent: config.targetPercent,
          tokens: usage.tokens,
          limit,
        })
      }
    } catch (error) {
      log("[compress-watchdog] hook failed", {
        sessionID: event.sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return [registration]
}

export { COMPRESS_WATCHDOG_MARKER }
