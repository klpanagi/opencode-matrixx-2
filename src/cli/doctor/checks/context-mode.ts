import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOmoOpenCodeCacheDir } from "../../../shared/config/data-path"
import { getOpenCodeConfigDir } from "../../../shared/config/opencode-config-dir"
import { isCtxToolsAvailable, resolveContextModeDisciplineInfo } from "../../../shared/policy/context-mode-enforcement"
import { parseJsoncSafe } from "../../../shared/text/jsonc-parser"
import type { CheckResult, DoctorCheck } from "../types"

export const CONTEXT_MODE_V1_TOOLS = ["ctx_batch_execute", "ctx_execute_file", "ctx_fetch_and_index"] as const

export const CONTEXT_MODE_V2_TOOLS = [
  "ctx_execute",
  "ctx_batch",
  "ctx_index",
  "ctx_search",
  "ctx_resume",
  "ctx_stats",
  "ctx_doctor",
  "ctx_upgrade",
  "ctx_purge",
] as const

const V1_TO_V2_HINT: Record<string, string> = {
  ctx_batch_execute: "ctx_batch_execute \u2192 ctx_batch",
  ctx_execute_file: "ctx_execute_file \u2192 ctx_execute with file param",
  ctx_fetch_and_index: "ctx_fetch_and_index \u2192 ctx_index then ctx_search",
}

/**
 * Pure evaluator for the context-mode tool-key compat check.
 *
 * Policy (locked): V1 keys are NEVER a hard failure — they pass with a
 * migration hint naming the V2 replacements. V2-only keys pass clean.
 * No ctx_* tools at all fails with an actionable message.
 */
export function evaluateContextModeToolCompat(toolNames: string[]): CheckResult {
  const name = "context-mode-tools"
  const available = new Set(toolNames)
  const presentV1 = CONTEXT_MODE_V1_TOOLS.filter((t) => available.has(t))
  const presentV2 = CONTEXT_MODE_V2_TOOLS.filter((t) => available.has(t))
  if (presentV1.length === 0 && presentV2.length === 0) {
    return {
      name,
      status: "fail",
      message: "context-mode tools not found — no ctx_* tools registered",
      detail:
        "Install context-mode@2.1 (any 2.1.x) and register it (plugin entry or " +
        "mcp.servers in opencode.jsonc), then re-run doctor. Expected V2 tools: " +
        `${[...CONTEXT_MODE_V2_TOOLS].join(", ")}.`,
    }
  }
  if (presentV1.length > 0) {
    return {
      name,
      status: "pass",
      message: `context-mode tools available (${presentV1.length + presentV2.length} found, including V1 keys) — migration hint present`,
      detail: `Found V1: ${presentV1.join(", ")}${presentV2.length > 0 ? `; found V2: ${presentV2.join(", ")}` : ""}. Migration: ${presentV1.map((t) => V1_TO_V2_HINT[t]).join("; ")}.`,
    }
  }
  return {
    name,
    status: "pass",
    message: `context-mode V2 tools available (${presentV2.length}/${CONTEXT_MODE_V2_TOOLS.length})`,
    detail: `Found: ${presentV2.join(", ")}.`,
  }
}

function loadContextModeConfig(): { enabled: boolean } | null {
  const dir = getOpenCodeConfigDir({ binary: "opencode" })
  const bases = [join(dir, "matrixx"), join(process.cwd(), ".opencode", "matrixx"), join(process.cwd(), "matrixx")]
  for (const base of bases) {
    for (const ext of [".jsonc", ".json"]) {
      const p = `${base}${ext}`
      if (!existsSync(p)) continue
      try {
        const c = readFileSync(p, "utf-8")
        const parsed = parseJsoncSafe<Record<string, unknown>>(c)
        if (!parsed.data || parsed.errors.length > 0) continue
        const cm = parsed.data.context_mode as Record<string, unknown> | undefined
        if (cm && typeof cm.enabled === "boolean") return { enabled: cm.enabled as boolean }
      } catch {}
    }
  }
  return null
}

function hasContextModePluginEntry(parsed: Record<string, unknown>): boolean {
  const plugin = parsed.plugin
  if (!Array.isArray(plugin)) return false
  for (const entry of plugin) {
    if (typeof entry !== "string") continue
    if (entry === "context-mode" || entry === "@tarquinen/context-mode" || entry === "opencode-context-mode" || entry.includes("context-mode")) return true
  }
  return false
}

function hasContextModeMcpEntry(parsed: Record<string, unknown>): boolean {
  const mcp = parsed.mcp
  if (typeof mcp !== "object" || mcp === null) return false
  const servers = (mcp as Record<string, unknown>).servers
  if (typeof servers !== "object" || servers === null) return false
  return (servers as Record<string, unknown>)["context-mode"] !== undefined
}

function hasContextModeRegistration(): boolean {
  const dir = getOpenCodeConfigDir({ binary: "opencode" })
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const p = join(dir, name)
    if (!existsSync(p)) continue
    try {
      const c = readFileSync(p, "utf-8")
      const parsed = parseJsoncSafe<Record<string, unknown>>(c)
      if (!parsed.data || parsed.errors.length > 0) continue
      if (hasContextModePluginEntry(parsed.data) || hasContextModeMcpEntry(parsed.data)) return true
    } catch {}
  }
  return false
}

/**
 * Pure evaluator for the context-mode MCP server cwd-sanity check.
 *
 * Root cause (verified against the external context-mode package's opencode
 * adapter): the adapter derives its project dir as
 * `ctx?.directory ?? process.cwd()`. A process-global MCP server (registered
 * in the user's global opencode.jsonc) has no plugin ctx, so every project
 * inherits the MCP server process's spawn cwd — observed running with the
 * cwd of a different project. Matrixx cannot patch the external server; this
 * check warns when the registration lacks an explicit cwd pin and points at
 * the per-project registration fix.
 *
 * Scope: MCP-only. Local plugin and registry installs resolve their own
 * directory and never inherit a spawn cwd, so the check passes (skips) for
 * those sources instead of warning.
 */
export function evaluateContextModeCwd(server: unknown, source: "mcp" | "local" | "registry" | string = "mcp"): CheckResult {
  const name = "context-mode-cwd"
  if (source === "local" || source === "registry") {
    return {
      name,
      status: "pass",
      message: `context-mode ${source} install — cwd sanity check is MCP-only, skipping`,
    }
  }
  if (typeof server !== "object" || server === null) {
    return {
      name,
      status: "pass",
      message: "context-mode MCP server not registered — no cwd to sanity-check",
    }
  }
  const cwd = (server as Record<string, unknown>).cwd
  if (typeof cwd === "string" && cwd.trim().length > 0) {
    return {
      name,
      status: "pass",
      message: "context-mode MCP server pins an explicit cwd",
      detail: `cwd: ${cwd.trim()}`,
    }
  }
  return {
    name,
    status: "warn",
    message: "context-mode MCP server registered without an explicit cwd",
    detail:
      "A process-global MCP server inherits its spawn cwd, so ctx_execute runs " +
      "with the wrong project directory in every other project. Register the " +
      "context-mode MCP server per-project (.opencode/opencode.json mcp entry) " +
      "so each project gets a server with the right cwd, or pin cwd explicitly.",
  }
}

function loadContextModeMcpServer(): unknown {
  const dir = getOpenCodeConfigDir({ binary: "opencode" })
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const p = join(dir, name)
    if (!existsSync(p)) continue
    try {
      const c = readFileSync(p, "utf-8")
      const parsed = parseJsoncSafe<Record<string, unknown>>(c)
      if (!parsed.data || parsed.errors.length > 0) continue
      const mcp = parsed.data.mcp
      if (typeof mcp !== "object" || mcp === null) continue
      const servers = (mcp as Record<string, unknown>).servers
      if (typeof servers !== "object" || servers === null) continue
      const server = (servers as Record<string, unknown>)["context-mode"]
      if (server !== undefined) return server
    } catch {}
  }
  return undefined
}

export const CONTEXT_MODE_VERSION_FLOOR = "2.1.0"

/**
 * Pure floor check: major.minor numeric compare against 2.1.
 * Prerelease suffixes (e.g. 2.1.0-next) are stripped before parsing;
 * null/unparsable versions fail-open to false (never blocks doctor).
 */
export function isContextModeVersionBelowFloor(version: string | null | undefined): boolean {
  if (typeof version !== "string" || version.length === 0) return false
  const core = version.replace(/^[vV]/, "").split("-")[0] ?? ""
  const parts = core.split(".")
  const major = Number(parts[0])
  const minor = parts.length > 1 ? Number(parts[1]) : 0
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  if (major < 2) return true
  if (major > 2) return false
  return minor < 1
}

/** Pure evaluator for the discipline version floor. Below 2.1.0 warns. */
export function evaluateContextModeVersion(version: string | null | undefined): CheckResult {
  const name = "context-mode-version"
  if (isContextModeVersionBelowFloor(version)) {
    return {
      name,
      status: "warn",
      message: `context-mode discipline v${version} is below the supported floor v${CONTEXT_MODE_VERSION_FLOOR}`,
      detail: `Upgrade context-mode to >=${CONTEXT_MODE_VERSION_FLOOR} (any 2.1.x) for the current discipline text.`,
    }
  }
  return {
    name,
    status: "pass",
    message: `context-mode discipline version ${version ?? "unknown"} meets floor v${CONTEXT_MODE_VERSION_FLOOR}`,
  }
}

export const contextModeCwdCheck: DoctorCheck = {
  name: "context-mode-cwd",
  category: "integrations",
  check: (): CheckResult => evaluateContextModeCwd(loadContextModeMcpServer(), "mcp"),
}

export const contextModeCheck: DoctorCheck = {
  name: "context-mode-integration",
  category: "integrations",
  check: (): CheckResult => {
    const cfg = loadContextModeConfig()
    if (cfg && !cfg.enabled) {
      return {
        name: "context-mode-integration",
        status: "pass",
        message: "context-mode disabled via matrixx.jsonc — skipping",
        detail: "Set context_mode.enabled:true in matrixx.jsonc to enable discipline and enforcer",
      }
    }
    const hasRegistration = hasContextModeRegistration()
    const cacheDir = getOmoOpenCodeCacheDir()
    const hasCache = existsSync(cacheDir)
    if (!hasRegistration) {
      return {
        name: "context-mode-integration",
        status: "warn",
        message: "context-mode plugin not registered",
        detail: `Add "context-mode" to the plugin array or mcp.servers in ${join(getOpenCodeConfigDir({ binary: "opencode" }), "opencode.jsonc")}\nCache dir: ${cacheDir} ${hasCache ? "(exists)" : "(not found — will be created on first use)"}`,
      }
    }
    const discipline = resolveContextModeDisciplineInfo()
    const substituteLine = discipline.path
      ? `Substitute-File: ${discipline.path}${discipline.version ? ` (v${discipline.version})` : ""}`
      : "Substitute-File: not found — fallback table in use; enforcer treats grep/glob as unblocked"
    const ctxTools = isCtxToolsAvailable()
    const ctxToolsLine = ctxTools
      ? "Ctx-Tools: available"
      : "Ctx-Tools: unavailable — enforcer fail-opens (warn-only)"
    const belowFloor = isContextModeVersionBelowFloor(discipline.version)
    const floorLine = belowFloor
      ? `Version-Floor: v${discipline.version} below supported floor v${CONTEXT_MODE_VERSION_FLOOR} — upgrade context-mode to >=${CONTEXT_MODE_VERSION_FLOOR} (any 2.1.x)`
      : null
    return {
      name: "context-mode-integration",
      status: !discipline.path || !ctxTools || belowFloor ? "warn" : "pass",
      message: `context-mode plugin registered${hasCache ? ", cache present" : " (cache not yet created)"}${discipline.version ? `, discipline v${discipline.version}` : ""}${belowFloor ? ` (below floor v${CONTEXT_MODE_VERSION_FLOOR})` : ""}`,
      detail: `Cache: ${cacheDir}\n${substituteLine}\n${ctxToolsLine}${floorLine ? `\n${floorLine}` : ""}\nPlan tools: plan_create/read/update/list/delete (unconditional)`,
    }
  },
}
