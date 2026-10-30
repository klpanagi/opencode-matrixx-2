import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { KnowledgeHub } from "../../config/schema/knowledge"
import { type ContextCollector, contextCollector } from "../../features/context-injector"
import { expandHubPath } from "../../features/knowledge-hub/loader"
import { getMainSessionID } from "../../features/session-state/state"
import { createDynamicTruncator } from "../../shared/dynamic-truncator"
import { notifyInjection } from "../../shared/injection-notifier"
import { log } from "../../shared/logger"
import { roleOf, type SessionMessage } from "../../shared/session-message"
import type { MatrixxContext, V2Registration } from "../context"

const INDEX_MAX_TOKENS = 6000

const ROUTER_DIRECTIVE =
  "Consult these hubs before websearch/webfetch; open files via @hub/path on demand, never bulk-read."

export interface FlatMessageHookEvent {
  readonly sessionID: string
  messages: SessionMessage[]
}

export interface KnowledgeHubInjectorDeps {
  getHubs?: () => KnowledgeHub[]
  collector?: ContextCollector
  pinnedFiles?: string[]
  workspaceDir?: string
}

const sessionCaches = new Map<string, Set<string>>()

export function _resetKnowledgeHubInjectorForTesting(): void {
  sessionCaches.clear()
}

export function clearKnowledgeHubSession(sessionID: string, collector?: ContextCollector): void {
  sessionCaches.delete(sessionID)
  const target = collector ?? contextCollector
  target.clear(sessionID)
}

function resolveHubPaths(hub: KnowledgeHub, workspaceDir: string): { root: string; indexPath: string } {
  const root = expandHubPath(hub.path, workspaceDir)
  return { root, indexPath: path.join(root, hub.index ?? "_index.md") }
}

function readQuiet(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

function collectBlocks(
  injected: Set<string>,
  blocks: string[],
  hubs: KnowledgeHub[],
  workspaceDir: string,
  pinnedFiles: string[],
  truncate: (content: string) => string,
): void {
  for (const hub of hubs) {
    const { root, indexPath } = resolveHubPaths(hub, workspaceDir)
    appendOnce(injected, `${hub.name}:${indexPath}`, indexPath, blocks, `knowledge-hub name="${hub.name}"`, "knowledge-hub", truncate)
    if (hub.mode === "pinned") {
      for (const pinned of pinnedFiles) {
        const pinnedPath = path.isAbsolute(pinned) ? pinned : path.join(root, pinned)
        appendOnce(
          injected,
          `pinned:${pinnedPath}`,
          pinnedPath,
          blocks,
          `knowledge-hub-pin name="${hub.name}" file="${pinnedPath}"`,
          "knowledge-hub-pin",
          truncate,
        )
      }
    }
  }
}

function appendOnce(
  injected: Set<string>,
  key: string,
  filePath: string,
  blocks: string[],
  openTag: string,
  closeTag: string,
  truncate: (content: string) => string,
): void {
  if (injected.has(key)) return
  injected.add(key)
  const content = readQuiet(filePath)
  if (content === null) {
    log("[knowledge-hub-injector] missing file, skipping", { filePath })
    return
  }
  blocks.push(`<${openTag}>\n${truncate(content)}\n</${closeTag}>`)
}

export async function applyKnowledgeHubInjector(
  event: FlatMessageHookEvent,
  ctx: MatrixxContext,
  deps: KnowledgeHubInjectorDeps = {},
): Promise<void> {
  const messages = event?.messages
  if (!messages || messages.length === 0) return

  let hasUserMessage = false
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") {
      hasUserMessage = true
      break
    }
  }
  if (!hasUserMessage) return

  const sessionID = event.sessionID ?? getMainSessionID()
  if (!sessionID) return

  let injected = sessionCaches.get(sessionID)
  if (!injected) {
    injected = new Set<string>()
    sessionCaches.set(sessionID, injected)
  }

  const collector = deps.collector ?? contextCollector
  const workspaceDir = deps.workspaceDir ?? ctx?.directory ?? process.cwd()
  const pinnedFiles = deps.pinnedFiles ?? []
  let hubs: KnowledgeHub[]
  try {
    hubs = deps.getHubs?.() ?? []
  } catch {
    log("[knowledge-hub-injector] hub resolve failed, skipping")
    return
  }

  const truncator = createDynamicTruncator(ctx)
  const truncate = (content: string): string => truncator.truncateSync(content, INDEX_MAX_TOKENS).result
  const blocks: string[] = []
  collectBlocks(injected, blocks, hubs, workspaceDir, pinnedFiles, truncate)
  if (blocks.length === 0) return

  collector.register(sessionID, {
    id: "knowledge-hub-router",
    source: "custom",
    content: `${ROUTER_DIRECTIVE}\n\n${blocks.join("\n\n")}`,
    priority: "high",
  })
  log("[knowledge-hub-injector] router registered", { sessionID, blocks: blocks.length })
  if (ctx) {
    await notifyInjection(ctx, {
      sessionID,
      injector: "knowledge-hub-injector",
      hash: blocks.join("\n\n"),
      title: "Context injection",
      message: "Knowledge hub applied",
    })
  }
}

export async function registerKnowledgeHubInjector(
  ctx: MatrixxContext,
  deps: KnowledgeHubInjectorDeps = {},
): Promise<V2Registration[]> {
  const registration = await ctx.session.hook("context", async (event) => {
    await applyKnowledgeHubInjector(
      { sessionID: event.sessionID, messages: event.messages as SessionMessage[] },
      ctx,
      { ...deps, workspaceDir: deps.workspaceDir ?? ctx.directory },
    )
  })
  return [registration]
}
