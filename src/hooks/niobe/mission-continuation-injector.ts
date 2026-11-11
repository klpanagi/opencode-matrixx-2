import { promptNativeWithModelSuggestionRetry } from "../../shared/model/model-suggestion-retry"
import { log } from "../../shared/runtime/logger"
import type { NativePluginContext } from "../../shared/session/session-context-source"
import { HOOK_NAME } from "./hook-name"
import { resolveRecentModelForSession } from "./recent-model-resolver"
import { MISSION_CONTINUATION_PROMPT } from "./system-reminder-templates"
import type { SessionState } from "./types"

export async function injectMissionContinuation(input: {
  ctx: NativePluginContext
  sessionID: string
  planName: string
  remaining: number
  total: number
  agent?: string
  sessionState: SessionState
}): Promise<void> {
  const {
    ctx,
    sessionID,
    planName,
    remaining,
    total,
    agent,
    sessionState,
  } = input

  const prompt =
    MISSION_CONTINUATION_PROMPT.replace(/{PLAN_NAME}/g, planName) +
    `\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]`

  try {
    log(`[${HOOK_NAME}] Injecting mission continuation`, { sessionID, planName, remaining })

    const model = await resolveRecentModelForSession(ctx, sessionID)

    await promptNativeWithModelSuggestionRetry(ctx.session, {
      sessionID,
      agent: agent ?? "niobe",
      ...(model !== undefined ? { model } : {}),
      parts: [{ type: "text", text: prompt }],
    })

    sessionState.promptFailureCount = 0
    log(`[${HOOK_NAME}] Mission continuation injected`, { sessionID })
  } catch (err) {
    sessionState.promptFailureCount += 1
    log(`[${HOOK_NAME}] Mission continuation failed`, {
      sessionID,
      error: String(err),
      promptFailureCount: sessionState.promptFailureCount,
    })
  }
}
