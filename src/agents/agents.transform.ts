/**
 * V2-native agent domain transform (D4).
 *
 * Owned by `src/agents/`: pure entry replay + single `ctx.agent.transform`
 * registration. `createBuiltinAgents` in `./builtin-agents` stays the (async,
 * IO-at-the-edge) composer that resolves models and overrides; this module
 * only folds already-built entries onto the domain, so repeated runs over the
 * same entries replay identically with no filesystem or network effects.
 */

/** Minimal structural agent: the real V2 `AgentInfo` satisfies this. */
export interface AgentTransformInfo {
  model?: { providerID: string; id: string; variant?: string }
  request: {
    settings?: Record<string, unknown>
    headers?: Record<string, string>
    body?: Record<string, unknown>
  }
  system?: string
  description?: string
  mode: "primary" | "subagent" | "all"
  hidden: boolean
  color?: string
  steps?: number
  permissions: unknown[]
  [key: string]: unknown
}

/** Minimal structural editor: the real V2 `AgentEditor` satisfies this. */
export interface AgentTransformEditor {
  update(id: string, update: (agent: AgentTransformInfo) => void): void
  remove(id: string): void
  default(id: string | undefined): void
}

export interface AgentTransformDomain {
  transform(callback: (editor: AgentTransformEditor) => void): Promise<unknown>
}

export interface AgentTransformEntryFailure {
  name: string
  error: string
}

export interface RegisterAgentTransformInput {
  agents?: Record<string, unknown>
  defaultAgent?: string
}

export interface RegisterAgentTransformResult {
  registration: unknown
  registered: string[]
  failures: AgentTransformEntryFailure[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

/**
 * Pure fold of one entry onto an agent record. MERGE, not replace, for
 * permissions: evaluation is last-match-wins over `[...Info.default, ...ours]`,
 * so our rules win where they overlap while the seeded ruleset keeps the
 * default secret-read guard.
 */
export function applyAgentEntry(agent: AgentTransformInfo, entry: unknown): void {
  const next = asRecord(entry)
  if (next.model !== undefined) agent.model = next.model as AgentTransformInfo["model"]
  if (typeof next.system === "string") agent.system = next.system
  if (typeof next.description === "string") agent.description = next.description
  if (next.mode === "primary" || next.mode === "subagent" || next.mode === "all") agent.mode = next.mode
  if (typeof next.hidden === "boolean") agent.hidden = next.hidden
  if (typeof next.color === "string") agent.color = next.color
  if (typeof next.steps === "number") agent.steps = next.steps

  const request = asRecord(next.request)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(asRecord(request.headers))) {
    if (typeof value === "string") headers[key] = value
  }
  const body = asRecord(request.body)
  if (Object.keys(body).length > 0 || Object.keys(headers).length > 0) {
    agent.request = {
      settings: { ...(agent.request.settings ?? {}), ...asRecord(request.settings) },
      headers: { ...(agent.request.headers ?? {}), ...headers },
      body: { ...(agent.request.body ?? {}), ...body },
    }
  }

  if (Array.isArray(next.permissions)) {
    // Dedupe identical rules so replaying the same entry over a persistent
    // editor is idempotent (no duplicate side effects on re-registration).
    const seen = new Set(agent.permissions.map((rule) => JSON.stringify(rule)))
    for (const rule of next.permissions) {
      const key = JSON.stringify(rule)
      if (!seen.has(key)) {
        seen.add(key)
        agent.permissions.push(rule)
      }
    }
  }
}

/**
 * Pure replay: agent entries → `ctx.agent.transform`.
 * The only effect is the single `transform` call; the callback only calls
 * `editor.update` / `editor.remove` / `editor.default`, so re-running over
 * the same input replays identically. `update` seeds a missing agent from its
 * default, which makes it the registration path as well — the editor has no `add`.
 */
export async function registerAgentTransform(
  agent: AgentTransformDomain,
  input: RegisterAgentTransformInput,
): Promise<RegisterAgentTransformResult> {
  const registered: string[] = []
  const failures: AgentTransformEntryFailure[] = []
  const registration = await agent.transform((editor) => {
    for (const [name, entry] of Object.entries(input.agents ?? {})) {
      if (asRecord(entry).disabled === true) {
        editor.remove(name)
        continue
      }
      try {
        editor.update(name, (info) => applyAgentEntry(info, entry))
        registered.push(name)
      } catch (error) {
        failures.push({ name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (input.defaultAgent !== undefined) editor.default(input.defaultAgent)
  })
  return { registration, registered, failures }
}
