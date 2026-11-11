/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  trinity: EXPLORATION_AGENT_DENYLIST,

  operator: EXPLORATION_AGENT_DENYLIST,

  merovingian: {
    write: false,
    edit: false,
    task: false,
  },

  seraph: {
    write: false,
    edit: false,
    task: false,
  },

  smith: {
    write: false,
    edit: false,
    task: false,
  },

  construct: {
    read: true,
  },

  mouse: {
    task: false,
  },

  "mouse-construct": {
    task: false,
  },

  "mouse-source": {
    task: false,
  },

  "mouse-rabbit-hole": {
    task: false,
  },

  "mouse-glitch": {
    task: false,
  },

  "mouse-bullet-time": {
    task: false,
  },

  "mouse-blue-pill": {
    task: false,
  },

  "mouse-the-one": {
    task: false,
  },

  "mouse-transmission": {
    task: false,
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}

