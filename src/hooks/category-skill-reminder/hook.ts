import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { getSessionAgent, subagentSessions } from "../../features/session-state/state"
import type { MatrixxContext } from "../../plugin/context"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent/agent-display-names"
import { notifyInjection } from "../../shared/policy/injection-notifier"
import type { NudgeEvent } from "./detector"
import { detectNudge } from "./detector"
import { buildReminderMessage } from "./formatter"

export type { NudgeEvent, NudgeInput } from "./detector"
export { detectNudge } from "./detector"

const TARGET_AGENTS = new Set([
  "morpheus",
  "mouse",
  "niobe",
])

const DELEGATABLE_WORK_TOOLS = new Set([
  "edit",
  "write",
  "bash",
  "shell",
  "read",
  "grep",
  "glob",
])

const DELEGATION_TOOLS = new Set([
   "task",
   "subagent",
])

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
  agent?: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

const DEDUP_WINDOW_MS = 60_000

interface SessionState {
  delegationUsed: boolean
  reminderShown: boolean
  toolCallCount: number
}

export interface CategorySkillReminderOptions {
  now?: () => number
}

function hashSnippet(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

import type { V2Event } from "../../plugin/context"
export function createCategorySkillReminderHook(
  ctx: MatrixxContext,
  availableSkills: AvailableSkill[] = [],
  options: CategorySkillReminderOptions = {},
) {
  const sessionStates = new Map<string, SessionState>()
  const lastNudgeAt = new Map<string, number>()
  const reminderMessage = buildReminderMessage(availableSkills)
  const now = options.now ?? Date.now

  function getOrCreateState(sessionID: string): SessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        delegationUsed: false,
        reminderShown: false,
        toolCallCount: 0,
      })
    }
    return sessionStates.get(sessionID) as SessionState
  }

  function clearSessionState(sessionID: string): void {
    sessionStates.delete(sessionID)
  }

  function clearSessionDedup(sessionID: string): void {
    const prefix = `${sessionID}:`
    for (const key of lastNudgeAt.keys()) {
      if (key.startsWith(prefix)) lastNudgeAt.delete(key)
    }
  }

  function isTargetAgent(sessionID: string, inputAgent?: string): boolean {
    const agent = getSessionAgent(sessionID) ?? inputAgent
    if (!agent) return false
    const agentKey = getAgentConfigKey(agent)
    return (
      TARGET_AGENTS.has(agentKey) ||
      agentKey.includes("morpheus") ||
      agentKey.includes("niobe")
    )
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    try {
      const { tool, sessionID } = input
      const toolLower = tool.toLowerCase()

      if (subagentSessions.has(sessionID)) return

      if (!isTargetAgent(sessionID, input.agent)) {
        return
      }

    const state = getOrCreateState(sessionID)

    if (DELEGATION_TOOLS.has(toolLower)) {
      state.delegationUsed = true
      log("[category-skill-reminder] Delegation tool used", { sessionID, tool })
      return
    }

    if (!DELEGATABLE_WORK_TOOLS.has(toolLower)) {
      return
    }

    state.toolCallCount++

    let nudge: NudgeEvent | null = null
    try {
      nudge = detectNudge({
        tool,
        sessionID,
        agent: input.agent,
        toolCallCount: state.toolCallCount,
        delegationUsed: state.delegationUsed,
        reminderShown: state.reminderShown,
      })
    } catch {
      nudge = null
    }

    if (nudge) {
      const dedupKey = `${sessionID}:${toolLower}:${nudge.skill}`
      const lastAt = lastNudgeAt.get(dedupKey)
      const current = now()
      if (lastAt !== undefined && current - lastAt < DEDUP_WINDOW_MS) {
        return
      }
      lastNudgeAt.set(dedupKey, current)
      output.output += reminderMessage
      state.reminderShown = true
      log("[category-skill-reminder] Reminder injected", {
        sessionID,
        toolCallCount: state.toolCallCount,
      })
      try {
        await notifyInjection(ctx, {
          sessionID,
          injector: "category-skill-reminder",
          hash: hashSnippet(reminderMessage),
          title: "Context injection",
          message: "Delegation guidance applied",
        })
      } catch {
        return
      }
      }
    } catch {
      return
    }
  }

  const eventHandler = async (event: V2Event) => {
    try {
      const props = event.data as Record<string, unknown> | undefined

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          clearSessionState(sessionInfo.id)
          clearSessionDedup(sessionInfo.id)
        }
      }

      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          clearSessionState(sessionID)
        }
      }
    } catch {
      return
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}