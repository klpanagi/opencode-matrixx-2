import { CATEGORY_DESCRIPTIONS, CATEGORY_PROMPT_APPENDS } from "../../shared/subagent/delegation-constants"
import type { AgentConfig } from "../shared/agent-config"
import { parseModelRef } from "../shared/agent-config"
import type { AgentFactory, AgentMode, AgentPromptMetadata } from "../shared/types"
import { buildMousePrompt, MOUSE_DEFAULTS } from "./mouse/agent"
import { buildTodoDisciplineSection } from "./mouse/shared"

const MODE: AgentMode = "subagent"

export const MOUSE_SUBAGENT_CATEGORIES = [
  "construct",
  "source",
  "rabbit-hole",
  "glitch",
  "bullet-time",
  "blue-pill",
  "the-one",
  "transmission",
] as const

export type MouseSubagentCategory = (typeof MOUSE_SUBAGENT_CATEGORIES)[number]

export const MOUSE_SUBAGENT_IDS = [
  "mouse-construct",
  "mouse-source",
  "mouse-rabbit-hole",
  "mouse-glitch",
  "mouse-bullet-time",
  "mouse-blue-pill",
  "mouse-the-one",
  "mouse-transmission",
] as const

export type MouseSubagentId = (typeof MOUSE_SUBAGENT_IDS)[number]

const CATEGORY_LABELS: Record<MouseSubagentCategory, string> = {
  construct: "Construct",
  source: "Source",
  "rabbit-hole": "Rabbit-Hole",
  glitch: "Glitch",
  "bullet-time": "Bullet-Time",
  "blue-pill": "Blue-Pill",
  "the-one": "The-One",
  transmission: "Transmission",
}

export function mouseSubagentIdFor(category: MouseSubagentCategory): MouseSubagentId {
  return `mouse-${category}` as MouseSubagentId
}

function buildWorkerPrompt(model: string | undefined, category: MouseSubagentCategory): string {
  const base = buildMousePrompt(model)
  const nested = `<Nested_Delegation>
OVERRIDE: the solo-Mouse "NEVER delegate" constraint in the base prompt above
does NOT apply to you. You MAY spawn child subagents for parallel exploration
or sub-tasks (depth-3 nesting is allowed). You own the task-store records for
the work you run: break work down with task_create/task_update first, then
delegate. All other Mouse discipline (task obsession, verification) applies.
</Nested_Delegation>`
  const append = CATEGORY_PROMPT_APPENDS[category] ?? ""
  return `${base}\n\n${nested}\n\n${append}\n\n${buildTodoDisciplineSection()}`
}

function createFactory(category: MouseSubagentCategory): AgentFactory {
  const factory = (model: string): AgentConfig => ({
    description: `${CATEGORY_DESCRIPTIONS[category]} (Mouse ${CATEGORY_LABELS[category]} - Matrixx)`,
    mode: MODE,
    hidden: false,
    model: parseModelRef(model),
    request: {
      body: {
        temperature: MOUSE_DEFAULTS.temperature,
      },
    },
    system: buildWorkerPrompt(model, category),
  })
  factory.mode = MODE
  return factory
}

export const createMouseConstructAgent = createFactory("construct")
export const createMouseSourceAgent = createFactory("source")
export const createMouseRabbitHoleAgent = createFactory("rabbit-hole")
export const createMouseGlitchAgent = createFactory("glitch")
export const createMouseBulletTimeAgent = createFactory("bullet-time")
export const createMouseBluePillAgent = createFactory("blue-pill")
export const createMouseTheOneAgent = createFactory("the-one")
export const createMouseTransmissionAgent = createFactory("transmission")

export const MOUSE_SUBAGENT_PROMPT_METADATA: Record<MouseSubagentId, AgentPromptMetadata> = {
  "mouse-construct": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Construct (frontend/UI)", trigger: "Visual/UI work routed to a dedicated leaf executor" }],
  },
  "mouse-source": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Source (hard logic)", trigger: "Logic-heavy work routed to a dedicated leaf executor" }],
  },
  "mouse-rabbit-hole": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Rabbit-Hole (deep research)", trigger: "Autonomous research routed to a dedicated leaf executor" }],
  },
  "mouse-glitch": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Glitch (creative)", trigger: "Creative work routed to a dedicated leaf executor" }],
  },
  "mouse-bullet-time": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Bullet-Time (trivial)", trigger: "Single-file fixes routed to a dedicated leaf executor" }],
  },
  "mouse-blue-pill": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Blue-Pill (easy misc)", trigger: "Low-effort misc work routed to a dedicated leaf executor" }],
  },
  "mouse-the-one": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "The-One (hard misc)", trigger: "High-effort misc work routed to a dedicated leaf executor" }],
  },
  "mouse-transmission": {
    category: "utility",
    cost: "CHEAP",
    triggers: [{ domain: "Transmission (docs)", trigger: "Documentation routed to a dedicated leaf executor" }],
  },
}

export const mouseSubagentFactories: Record<MouseSubagentId, AgentFactory> = {
  "mouse-construct": createMouseConstructAgent,
  "mouse-source": createMouseSourceAgent,
  "mouse-rabbit-hole": createMouseRabbitHoleAgent,
  "mouse-glitch": createMouseGlitchAgent,
  "mouse-bullet-time": createMouseBulletTimeAgent,
  "mouse-blue-pill": createMouseBluePillAgent,
  "mouse-the-one": createMouseTheOneAgent,
  "mouse-transmission": createMouseTransmissionAgent,
}
