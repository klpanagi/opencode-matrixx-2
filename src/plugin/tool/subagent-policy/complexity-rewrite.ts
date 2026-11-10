import { MOUSE_SUBAGENT_IDS } from "../../../agents/definitions/mouse-subagents"
// Phase 5: shared modules relocated to src/shared/subagent/ (delegate-task/ deleted).
import { resolveComplexityModel } from "../../../shared/subagent/complexity-constants"
import { autoScoreComplexity } from "../../../shared/subagent/complexity-scorer"
import type { ComplexityLevel } from "../../../shared/subagent/complexity-types"

export const COMPLEXITY_KEY = "complexity"

const MOUSE_WORKER_IDS = new Set<string>(MOUSE_SUBAGENT_IDS as readonly string[])

export function mouseCategoryFor(agentId: string): string | undefined {
  const lower = agentId.toLowerCase()
  if (!MOUSE_WORKER_IDS.has(lower)) return undefined
  return lower.slice("mouse-".length)
}

export interface ComplexityRewriteDeps {
  downgrades?: Record<string, Record<string, string>>
  userDowngrades?: Record<string, Record<string, string>>
  defaultModelFor?: (agentId: string) => string | undefined
  scoreComplexity?: typeof autoScoreComplexity
  resolveDowngrade?: typeof resolveComplexityModel
}

function parseComplexityLevel(raw: unknown): ComplexityLevel | "auto" | undefined {
  if (raw === undefined || raw === "auto") return raw as "auto" | undefined
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) return raw
  throw new Error(`[subagent-policy] "complexity" must be 1-5 or "auto"`)
}

export function applyComplexityRewrite(
  args: Record<string, unknown>,
  deps: ComplexityRewriteDeps = {},
  loadSkills: string[] = [],
): { downgraded: boolean } {
  const rawComplexity = args[COMPLEXITY_KEY]
  delete args[COMPLEXITY_KEY]
  const agent = args.agent
  if (typeof agent !== "string") return { downgraded: false }
  const category = mouseCategoryFor(agent)
  if (!category) return { downgraded: false }
  if (typeof args.sessionID === "string" && args.sessionID !== "") {
    return { downgraded: false }
  }
  const score = deps.scoreComplexity ?? autoScoreComplexity
  const resolve = deps.resolveDowngrade ?? resolveComplexityModel
  const parsed = parseComplexityLevel(rawComplexity)
  const level: ComplexityLevel =
    parsed === undefined || parsed === "auto"
      ? score({
          description: typeof args.description === "string" ? args.description : undefined,
          prompt: typeof args.prompt === "string" ? args.prompt : undefined,
          loadSkills,
          category,
        })
      : parsed
  const base =
    typeof args.model === "string" && args.model !== ""
      ? args.model
      : deps.defaultModelFor?.(agent)
  if (!base) return { downgraded: false }
  const holder = deps.downgrades ? { complexityDowngrades: deps.downgrades } : undefined
  const { model, downgraded } = resolve(category, level, base, deps.userDowngrades?.[category], holder)
  if (downgraded) {
    args.model = model
  }
  return { downgraded }
}
