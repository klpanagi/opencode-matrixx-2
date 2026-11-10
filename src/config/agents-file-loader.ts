import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { deepMerge } from "../shared/config/deep-merge"
import { log } from "../shared/runtime/logger"
import { parseJsoncSafe } from "../shared/text/jsonc-parser"
import type { AgentOverrides } from "./schema/agent-overrides"
import {
  type AgentsFileContent,
  AgentsFileSchema,
} from "./schema/agents-file"
import type { CategoriesConfig } from "./schema/categories"

export const DEFAULT_AGENTS_FILENAME = "matrixx.agents.jsonc"

export interface AgentsFileResult {
  file: AgentsFileContent | null
  error?: string
}

function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  return p
}

export function resolveAgentsFilePath(configPath: string, pointer?: string): string {
  const dir = dirname(configPath)
  if (!pointer) {
    const jsonc = join(dir, DEFAULT_AGENTS_FILENAME)
    // Fallback to .json sibling when no .jsonc exists (same detectConfigFile order).
    if (!existsSync(jsonc)) {
      const json = join(dir, "matrixx.agents.json")
      if (existsSync(json)) return json
    }
    return jsonc
  }
  const expanded = expandHome(pointer)
  if (isAbsolute(expanded)) return expanded
  return join(dir, expanded)
}

export function loadAgentsFile(agentsPath: string): AgentsFileResult {
  if (!existsSync(agentsPath)) return { file: null }
  let content: string
  try {
    content = readFileSync(agentsPath, "utf-8")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log("Agents file unreadable", { agentsPath, message })
    return { file: null, error: message }
  }
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0 || parsed.data === null) {
    const message = parsed.errors[0]?.message ?? "empty agents file"
    log("Agents file parse error", { agentsPath, message })
    return { file: null, error: message }
  }
  const validated = AgentsFileSchema.safeParse(parsed.data)
  if (!validated.success) {
    const message = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ")
    log("Agents file validation error", { agentsPath, message })
    return { file: null, error: message }
  }
  return { file: validated.data }
}

export function mergeFileAndInlineAgents(
  file: AgentsFileContent | null,
  inlineAgents?: AgentOverrides,
  inlineCategories?: CategoriesConfig,
): { agents?: AgentOverrides; categories?: CategoriesConfig } | undefined {
  const fileAgents = (file?.agents ?? undefined) as Record<string, unknown> | undefined
  const fileCategories = (file?.categories ?? undefined) as Record<string, unknown> | undefined
  const mergedAgents = deepMerge(
    fileAgents as AgentOverrides | undefined,
    inlineAgents,
  )
  const mergedCategories = deepMerge(
    fileCategories as CategoriesConfig | undefined,
    inlineCategories,
  )
  if (!mergedAgents && !mergedCategories) return undefined
  return { agents: mergedAgents, categories: mergedCategories }
}
