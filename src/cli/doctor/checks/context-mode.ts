import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveContextModeDisciplineInfo } from "../../../shared/context-mode-enforcement"
import { getOmoOpenCodeCacheDir } from "../../../shared/data-path"
import { parseJsoncSafe } from "../../../shared/jsonc-parser"
import { getOpenCodeConfigDir } from "../../../shared/opencode-config-dir"
import type { CheckResult, DoctorCheck } from "../types"

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
 */
export function evaluateContextModeCwd(server: unknown): CheckResult {
  const name = "context-mode-cwd"
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

export const contextModeCwdCheck: DoctorCheck = {
  name: "context-mode-cwd",
  category: "integrations",
  check: (): CheckResult => evaluateContextModeCwd(loadContextModeMcpServer()),
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
    const disciplineLine = discipline.path ? `Discipline: ${discipline.path}${discipline.version ? ` (v${discipline.version})` : ""}` : "Discipline: not found — fallback table in use"
    return {
      name: "context-mode-integration",
      status: "pass",
      message: `context-mode plugin registered${hasCache ? ", cache present" : " (cache not yet created)"}${discipline.version ? `, discipline v${discipline.version}` : ""}`,
      detail: `Cache: ${cacheDir}\n${disciplineLine}\nPlan tools: plan_create/read/update/list/delete (unconditional)`,
    }
  },
}
