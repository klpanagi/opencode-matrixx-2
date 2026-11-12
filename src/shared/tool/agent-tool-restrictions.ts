/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  subagent: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  trinity: EXPLORATION_AGENT_DENYLIST,

  operator: EXPLORATION_AGENT_DENYLIST,

  merovingian: {
    write: false,
    edit: false,
    subagent: false,
  },

  seraph: {
    write: false,
    edit: false,
    subagent: false,
  },

  smith: {
    write: false,
    edit: false,
    subagent: false,
  },

  construct: {
    read: true,
  },

  "mouse-construct": {
    subagent: false,
  },

  "mouse-source": {
    subagent: false,
  },

  "mouse-rabbit-hole": {
    subagent: false,
  },

  "mouse-glitch": {
    subagent: false,
  },

  "mouse-bullet-time": {
    subagent: false,
  },

  "mouse-blue-pill": {
    subagent: false,
  },

  "mouse-the-one": {
    subagent: false,
  },

  "mouse-transmission": {
    subagent: false,
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}

