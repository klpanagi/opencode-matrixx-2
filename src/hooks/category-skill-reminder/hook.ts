import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { getSessionAgent } from "../../features/session-state/state"
import type { MatrixxContext } from "../../plugin/context"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { notifyInjection } from "../../shared/injection-notifier"
import { buildReminderMessage } from "./formatter"

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

interface SessionState {
  delegationUsed: boolean
  reminderShown: boolean
  toolCallCount: number
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
  availableSkills: AvailableSkill[] = []
) {
  const sessionStates = new Map<string, SessionState>()
  const reminderMessage = buildReminderMessage(availableSkills)

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
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()

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

    if (state.toolCallCount >= 3 && !state.delegationUsed && !state.reminderShown) {
      output.output += reminderMessage
      state.reminderShown = true
      log("[category-skill-reminder] Reminder injected", {
        sessionID,
        toolCallCount: state.toolCallCount,
      })
      await notifyInjection(ctx, {
        sessionID,
        injector: "category-skill-reminder",
        hash: hashSnippet(reminderMessage),
        title: "Context injection",
        message: "Delegation guidance applied",
      })
    }
  }

  const eventHandler = async (event: V2Event) => {
    const props = event.data as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessionStates.delete(sessionInfo.id)
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessionStates.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
