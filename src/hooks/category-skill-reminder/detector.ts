import { getSessionAgent, subagentSessions } from "../../features/session-state/state"
import { getAgentConfigKey } from "../../shared/agent-display-names"

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

const NUDGE_THRESHOLD = 3
const NUDGE_SKILL = "construct"

export interface NudgeInput {
  tool: string
  sessionID: string
  agent?: string
  toolCallCount: number
  delegationUsed: boolean
  reminderShown: boolean
}

export interface NudgeEvent {
  skill: string
  reason: string
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

export function detectNudge(input: NudgeInput): NudgeEvent | null {
  try {
    if (subagentSessions.has(input.sessionID)) return null
    if (!isTargetAgent(input.sessionID, input.agent)) return null
    if (!DELEGATABLE_WORK_TOOLS.has(input.tool.toLowerCase())) return null
    if (input.delegationUsed || input.reminderShown) return null
    if (input.toolCallCount < NUDGE_THRESHOLD) return null
    return {
      skill: NUDGE_SKILL,
      reason: `delegatable work without delegation (${input.toolCallCount} ${input.tool} calls)`,
    }
  } catch {
    return null
  }
}
