import { readFileSync } from "node:fs"
import * as path from "node:path"
import { type ContextCollector, contextCollector } from "../../features/context-injection/injector"
import {
  HUB_AGGREGATE_TOKEN_CAP,
  HUB_INDEX_TOKEN_CAP,
  ROUTER_DIRECTIVE,
} from "../../features/knowledge-hub/constants"
import type { LoadedHub } from "../../features/knowledge-hub/loader"
import { getMainSessionID } from "../../features/session-state/state"
import { createDynamicTruncator } from "../../shared/compaction/dynamic-truncator"
import { notifyInjection } from "../../shared/policy/injection-notifier"
import { log } from "../../shared/runtime/logger"
import { roleOf, type SessionMessage } from "../../shared/session/session-message"
import type { MatrixxContext, V2Event, V2Registration } from "../tool/context"

const CHARS_PER_TOKEN_ESTIMATE = 4
const AGGREGATE_TRUNCATION_MARKER = "[knowledge-hub: aggregate cap reached, remaining hub content omitted]"

interface BlockBudget {
  usedTokens: number
  stopped: boolean
}

function estimateBlockTokens(block: string): number {
  return Math.ceil(block.length / CHARS_PER_TOKEN_ESTIMATE)
}

export interface FlatMessageHookEvent {
  readonly sessionID: string
  messages: SessionMessage[]
}

export interface KnowledgeHubInjectorDeps {
  getHubs?: () => LoadedHub[]
  collector?: ContextCollector
  workspaceDir?: string
}

const sessionCaches = new Map<string, Set<string>>()

export function _resetKnowledgeHubInjectorForTesting(): void {
  clearKnowledgeHubSession()
}

export function clearKnowledgeHubSession(sessionID?: string, collector?: ContextCollector): void {
  const target = collector ?? contextCollector
  if (sessionID === undefined) {
    for (const cached of sessionCaches.keys()) {
      target.clear(cached)
      sessionCaches.delete(cached)
    }
    return
  }
  sessionCaches.delete(sessionID)
  target.clear(sessionID)
}

export function handleKnowledgeHubEvent(event: V2Event, _deps: KnowledgeHubInjectorDeps = {}): void {
  const props = event.data as Record<string, unknown> | undefined
  if (event.type === "session.deleted") {
    const sessionInfo = props?.info as { id?: string } | undefined
    if (sessionInfo?.id) {
      clearKnowledgeHubSession(sessionInfo.id)
    }
  }
  if (event.type === "session.compacted") {
    const sessionID = (props?.sessionID ??
      (props?.info as { id?: string } | undefined)?.id) as string | undefined
    if (sessionID) {
      clearKnowledgeHubSession(sessionID)
    }
  }
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
  hubs: LoadedHub[],
  truncate: (content: string) => string,
  budget: BlockBudget,
): void {
  for (const hub of hubs) {
    if (!hub.indexPresent) {
      log("[knowledge-hub-injector] hub index absent, skipping", { name: hub.name, indexPath: hub.indexPath })
      continue
    }
    appendOnce(
      injected,
      `${hub.name}:${hub.indexPath}`,
      hub.indexPath,
      blocks,
      `knowledge-hub name="${hub.name}" root="${hub.root}" index="${hub.indexPath}"`,
      "knowledge-hub",
      truncate,
      budget,
    )
    if (hub.mode === "pinned" && hub.pinnedFiles.length > 0) {
      for (const pinned of hub.pinnedFiles) {
        const pinnedPath = path.isAbsolute(pinned) ? pinned : path.join(hub.root, pinned)
        appendOnce(
          injected,
          `pinned:${pinnedPath}`,
          pinnedPath,
          blocks,
          `knowledge-hub-pin name="${hub.name}" file="${pinnedPath}"`,
          "knowledge-hub-pin",
          truncate,
          budget,
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
  budget: BlockBudget,
): void {
  if (budget.stopped) return
  if (injected.has(key)) return
  const content = readQuiet(filePath)
  if (content === null) {
    log("[knowledge-hub-injector] missing file, skipping", { filePath })
    return
  }
  injected.add(key)
  const block = `<${openTag}>\n${truncate(content)}\n</${closeTag}>`
  const tokens = estimateBlockTokens(block)
  if (budget.usedTokens + tokens > HUB_AGGREGATE_TOKEN_CAP) {
    budget.stopped = true
    return
  }
  budget.usedTokens += tokens
  blocks.push(block)
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
  let hubs: LoadedHub[]
  try {
    hubs = deps.getHubs?.() ?? []
  } catch {
    log("[knowledge-hub-injector] hub resolve failed, skipping")
    return
  }

  const truncator = createDynamicTruncator(ctx)
  const truncate = (content: string): string => truncator.truncateSync(content, HUB_INDEX_TOKEN_CAP).result
  const blocks: string[] = []
  const budget: BlockBudget = { usedTokens: 0, stopped: false }
  collectBlocks(injected, blocks, hubs, truncate, budget)
  if (blocks.length === 0) return
  if (budget.stopped) {
    blocks.push(AGGREGATE_TRUNCATION_MARKER)
  }

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
