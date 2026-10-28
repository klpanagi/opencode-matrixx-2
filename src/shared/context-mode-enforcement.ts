import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { getOpenCodeCacheDir } from "./data-path"

/** Canonical default — hook, constants, and schema must all agree on this. */
export const CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS = ["grep", "glob", "webfetch"] as const

export interface ContextModeEnforcement {
  enabled: boolean
  enforce: boolean
  blockedTools: string[]
}

export interface ContextModeConfigInput {
  enabled?: boolean
  enforce?: boolean
  blocked_tools?: string[]
}

/**
 * Single source of truth for context-mode enforcement state.
 * Both the context-mode-enforcer hook (block decision) and the agent prompt
 * builders (guidance text) derive from this — prompt and hook can never
 * disagree because they read the same resolved flags.
 */
export function resolveContextModeEnforcement(
  contextMode: ContextModeConfigInput | undefined,
): ContextModeEnforcement {
  return {
    enabled: contextMode?.enabled ?? true,
    enforce: contextMode?.enforce ?? false,
    blockedTools: (contextMode?.blocked_tools ?? [...CONTEXT_MODE_DEFAULT_BLOCKED_TOOLS]).map((t) =>
      t.toLowerCase(),
    ),
  }
}

/** Exact tool-name match for the raw search tools (mirrors the hook's check). */
export function hasGrepGlobToolNames(toolNames: readonly string[]): boolean {
  return toolNames.some((n) => n === "grep" || n === "glob")
}

/**
 * Whether agent prompts may advertise a grep/glob fallback.
 * Usable = registered AND not blocked. Under enforce:true the hook throws on
 * grep/glob, so the prompt must never offer them — it must name the working
 * substitute (ctx_batch_execute / ctx_execute running `rg`) instead.
 */
export function resolveGrepGlobUsable(toolNames: readonly string[], contextMode?: ContextModeConfigInput): boolean {
  if (!hasGrepGlobToolNames(toolNames)) return false
  const cfg = contextMode !== undefined ? contextMode : _contextModeForPrompts
  return !willBlockGrepGlob(cfg)
}

let _disciplinePathOverride: string | null | undefined 
let _contextModeForPrompts: ContextModeConfigInput | undefined 

export function _setDisciplinePathForTesting(p: string | null | undefined): void {
  _disciplinePathOverride = p
}

export function setContextModeForPrompts(contextMode: ContextModeConfigInput | undefined): void {
  _contextModeForPrompts = contextMode
}

export function getContextModeForPrompts(): ContextModeConfigInput | undefined {
  return _contextModeForPrompts
}

export function _resetContextModeEnforcementForTesting(): void {
  _disciplinePathOverride = undefined
  _contextModeForPrompts = undefined
}

export function willBlockGrepGlob(contextMode: ContextModeConfigInput | undefined): boolean {
  const { enforce, blockedTools } = resolveContextModeEnforcement(contextMode)
  if (!enforce) return false
  if (!(blockedTools.includes("grep") || blockedTools.includes("glob"))) return false
  return hasWorkingSubstitute()
}

export function resolveContextModeDisciplinePath(): string | null {
  return resolveContextModeDisciplineInfo().path
}

const contextModeRequire = createRequire(import.meta.url)

/**
 * Walk up from a resolved file inside the context-mode package until a
 * directory containing a package.json with `"name": "context-mode"` is
 * found. Returns that directory, or null when no matching root exists.
 * Pure and unit-testable - every filesystem failure returns null (fail-open).
 */
export function deriveContextModeRootFromFile(resolvedFilePath: string): string | null {
  try {
    let dir = dirname(resolvedFilePath)
    while (true) {
      try {
        const raw = readFileSync(join(dir, "package.json"), "utf-8")
        const pkg = JSON.parse(raw) as { name?: unknown }
        if (pkg && pkg.name === "context-mode") return dir
      } catch {}
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  } catch {
    return null
  }
}

function readContextModeVersion(packageRoot: string | null): string | null {
  if (packageRoot === null) return null
  try {
    const raw = readFileSync(join(packageRoot, "package.json"), "utf-8")
    const pkg = JSON.parse(raw) as { version?: unknown }
    return typeof pkg.version === "string" ? pkg.version : null
  } catch {
    return null
  }
}

function resolveDisciplineCandidate(): { path: string; root: string | null } | null {
  try {
    const resolved = contextModeRequire.resolve("context-mode/configs/opencode/AGENTS.md")
    if (existsSync(resolved)) return { path: resolved, root: deriveContextModeRootFromFile(resolved) }
  } catch {}
  try {
    const entry = contextModeRequire.resolve("context-mode")
    const root = deriveContextModeRootFromFile(entry)
    if (root !== null) {
      const p = join(root, "configs/opencode/AGENTS.md")
      if (existsSync(p)) return { path: p, root }
    }
  } catch {}
  try {
    const cacheDir = getOpenCodeCacheDir()
    const p = join(cacheDir, "packages/context-mode@latest/node_modules/context-mode/configs/opencode/AGENTS.md")
    if (existsSync(p)) return { path: p, root: deriveContextModeRootFromFile(p) }
  } catch {}
  try {
    const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache")
    const p = join(base, "opencode/packages/context-mode@latest/node_modules/context-mode/configs/opencode/AGENTS.md")
    if (existsSync(p)) return { path: p, root: deriveContextModeRootFromFile(p) }
  } catch {}
  try {
    const p2 = join(homedir(), ".cache/opencode/packages/context-mode@latest/node_modules/context-mode/configs/opencode/AGENTS.md")
    if (existsSync(p2)) return { path: p2, root: deriveContextModeRootFromFile(p2) }
  } catch {}
  return null
}

export function resolveContextModeDisciplineInfo(): { path: string | null; version: string | null } {
  if (_disciplinePathOverride !== undefined) {
    if (_disciplinePathOverride === null) return { path: null, version: null }
    return {
      path: _disciplinePathOverride,
      version: readContextModeVersion(deriveContextModeRootFromFile(_disciplinePathOverride)),
    }
  }
  const found = resolveDisciplineCandidate()
  if (found === null) return { path: null, version: null }
  return { path: found.path, version: readContextModeVersion(found.root) }
}

export function hasWorkingSubstitute(): boolean {
  return resolveContextModeDisciplinePath() !== null
}
