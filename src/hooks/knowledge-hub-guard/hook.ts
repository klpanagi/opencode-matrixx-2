import * as os from "node:os"
import * as path from "node:path"
import picomatch from "picomatch"
import type { LoadedHub } from "../../features/knowledge-hub/loader"
import type { MatrixxContext } from "../../plugin/tool/context"
import { isShellTool } from "../../shared/io/shell-tool-name"
import { log } from "../../shared/runtime/logger"
import { isHubWriteApproved } from "./approvals"
import { analyzeBash } from "./bash-analysis"

const HOOK_NAME = "knowledge-hub-guard"

const WRITE_TOOLS = ["write", "edit", "multiedit", "ast_grep_replace", "lsp_rename"]
const AST_GREP_REPLACE_TOOL = "ast_grep_replace"
const LSP_RENAME_TOOL = "lsp_rename"
const MAX_MATCHER_CACHE = 256

const hubMatchers = new Map<string, (value: string) => boolean>()

export function clearHubMatcherCacheForTesting(): void {
  hubMatchers.clear()
}

export interface KnowledgeHubGuardOptions {
  hubs?: LoadedHub[]
  loadHubs?: () => LoadedHub[]
}

function resolveTarget(target: string, projectDir: string): string {
  let expanded = target
  if (expanded === "~") {
    expanded = os.homedir()
  } else if (expanded.startsWith("~/")) {
    expanded = path.join(os.homedir(), expanded.slice(2))
  }
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded)
  }
  return path.resolve(projectDir, expanded)
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function matcherFor(root: string, pattern: string): (value: string) => boolean {
  const key = `${root}\u0000${pattern}`
  const cached = hubMatchers.get(key)
  if (cached !== undefined) {
    return cached
  }
  const matcher = picomatch(pattern, { dot: true, bash: true })
  if (hubMatchers.size >= MAX_MATCHER_CACHE) {
    hubMatchers.clear()
  }
  hubMatchers.set(key, matcher)
  return matcher
}

function isExcluded(hub: LoadedHub, absPath: string): boolean {
  const rel = path.relative(hub.root, absPath)
  const base = path.basename(absPath)
  return hub.exclude.some((pattern) => {
    const match = matcherFor(hub.root, pattern)
    if (match(rel) || match(absPath)) {
      return true
    }
    return !pattern.includes("/") && match(base)
  })
}

function resolveToolTargets(tool: string, args: Record<string, unknown> | undefined, projectDir: string): string[] {
  if (!args) {
    return []
  }
  const raw: string[] = []
  if (tool === AST_GREP_REPLACE_TOOL) {
    const paths = args.paths
    if (typeof paths === "string" && paths.length > 0) {
      raw.push(paths)
    } else if (Array.isArray(paths)) {
      for (const entry of paths) {
        if (typeof entry === "string" && entry.length > 0) {
          raw.push(entry)
        }
      }
    }
    if (raw.length === 0) {
      return [path.normalize(projectDir)]
    }
  } else if (tool === LSP_RENAME_TOOL) {
    if (typeof args.filePath === "string" && args.filePath.length > 0) {
      raw.push(args.filePath)
    }
  } else {
    const filePath = args.filePath ?? args.path ?? args.file ?? args.file_path
    if (typeof filePath === "string" && filePath.length > 0) {
      raw.push(filePath)
    }
    if (typeof args.rename === "string" && args.rename.length > 0) {
      raw.push(args.rename)
    }
  }
  return raw.map((target) => resolveTarget(target, projectDir))
}

export function createKnowledgeHubGuardHook(ctx: MatrixxContext, options: KnowledgeHubGuardOptions = {}) {
  const projectDir = ctx.directory

  const resolveHubs = (): LoadedHub[] => {
    try {
      return options.loadHubs?.() ?? options.hubs ?? []
    } catch {
      log(`[${HOOK_NAME}] hub config unavailable, allowing writes (fail-open)`, {})
      return []
    }
  }

  const findBlockingHub = (hubs: LoadedHub[], absPath: string): LoadedHub | null => {
    for (const hub of hubs) {
      if (!insideRoot(hub.root, absPath)) {
        continue
      }
      if (isExcluded(hub, absPath)) {
        continue
      }
      return hub
    }
    return null
  }

  const deny = (hub: LoadedHub, absPath: string, tool: string, sessionID: string): void => {
    if (isHubWriteApproved(sessionID, absPath)) {
      log(`[${HOOK_NAME}] allowed hub write with user approval`, { sessionID, tool, hub: hub.name, path: absPath })
      return
    }
    log(`[${HOOK_NAME}] blocked write inside hub`, { sessionID, tool, hub: hub.name, path: absPath })
    throw new Error(
      `[${HOOK_NAME}] Write blocked: "${absPath}" is inside knowledge hub "${hub.name}". ` +
        `1. Ask the user via the question tool for confirmation. ` +
        `2. If approved, call knowledge_hub_confirm with the path then retry the write.`,
    )
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const tool = input.tool?.toLowerCase()
      const hubs = resolveHubs()
      if (isShellTool(tool)) {
        const command = output.args?.command as string | undefined
        if (typeof command === "string" && command.length > 0) {
          for (const target of analyzeBash(command, projectDir, projectDir)) {
            const hub = findBlockingHub(hubs, target)
            if (hub) {
              deny(hub, target, input.tool, input.sessionID)
            }
          }
        }
        return
      }
      if (!WRITE_TOOLS.includes(tool)) {
        return
      }
      const args = output.args as unknown as Record<string, unknown>
      for (const target of resolveToolTargets(tool, args, projectDir)) {
        const hub = findBlockingHub(hubs, target)
        if (hub) {
          deny(hub, target, input.tool, input.sessionID)
        }
      }
    },
  }
}
