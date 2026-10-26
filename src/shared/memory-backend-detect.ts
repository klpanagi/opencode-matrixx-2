import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { MemoryBackend } from "../config/schema/memory"
import { parseJsoncSafe } from "./jsonc-parser"

export interface MemoryBackendDetection {
  hasLcmTools: boolean
  hasSupermemoryTools: boolean
}

export function detectMemoryBackendTools(names: string[]): MemoryBackendDetection {
  const list = Array.isArray(names) ? names : []
  return {
    hasLcmTools: list.some((name) => typeof name === "string" && name.startsWith("lcm_")),
    hasSupermemoryTools: list.some(
      (name) => typeof name === "string" && name.startsWith("supermemory"),
    ),
  }
}

export function isMemoryBackendSatisfied(
  backend: MemoryBackend,
  detection: MemoryBackendDetection,
): boolean {
  if (backend === "lcm") return detection.hasLcmTools
  if (backend === "supermemory") return detection.hasSupermemoryTools
  return true
}

export function getMemoryBackendMissingWarning(backend: MemoryBackend): string {
  if (backend === "lcm") {
    return `[matrixx] memory.backend="lcm" but no lcm_* tools are registered. Install the opencode-lcm plugin (pinned 84103cca) so the 18 lcm_* tools are available; native session-memory stays OFF while backend="lcm".`
  }
  if (backend === "supermemory") {
    return `[matrixx] memory.backend="supermemory" but no supermemory tools are registered. Install the opencode-supermemory plugin (@latest) with supermemory.jsonc + SUPERMEMORY_API_KEY so supermemory/supermemory_recall are available; native session-memory stays OFF while backend="supermemory".`
  }
  return ""
}

export function getMemoryBackendRoutingHint(backend: MemoryBackend): string {
  if (backend === "lcm") {
    return `[matrixx] memory.backend="lcm": native session-memory is OFF — use the lcm_* tools (upstream SQLite/FTS5 build) for recall.`
  }
  if (backend === "supermemory") {
    return `[matrixx] memory.backend="supermemory": native session-memory is OFF — use supermemory / supermemory_recall for recall.`
  }
  return ""
}

interface MemoryBackendPlugins {
  hasLcmPlugin: boolean
  hasSupermemoryPlugin: boolean
  allPlugins: string[]
}

function memoryPluginConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), ".config")
  return [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(crossPlatformDir, "opencode", "opencode.json"),
    path.join(crossPlatformDir, "opencode", "opencode.jsonc"),
  ]
}

function loadOpencodePluginEntries(directory: string): string[] {
  for (const configPath of memoryPluginConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const result = parseJsoncSafe<{ plugin?: string[] }>(content)
      if (result.data) return result.data.plugin ?? []
    } catch {
    }
  }
  return []
}

function normalizePluginEntry(entry: string): string {
  const lower = entry.toLowerCase()
  const afterSlash = lower.split("/").pop() ?? lower
  const withoutVersion = afterSlash.split("@")[0] ?? afterSlash
  return withoutVersion.replace(/^npm:/, "")
}

export function detectMemoryBackendPlugins(directory: string): MemoryBackendPlugins {
  const allPlugins = loadOpencodePluginEntries(directory)
  let hasLcmPlugin = false
  let hasSupermemoryPlugin = false
  for (const entry of allPlugins) {
    const normalized = normalizePluginEntry(entry)
    if (/(^|[^a-z])lcm([^a-z]|$)/.test(normalized)) hasLcmPlugin = true
    if (normalized.includes("supermemory")) hasSupermemoryPlugin = true
  }
  return { hasLcmPlugin, hasSupermemoryPlugin, allPlugins }
}
