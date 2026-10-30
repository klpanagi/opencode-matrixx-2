import type { EvolutionConfig } from "../../config/schema/evolution"
import { traceStore } from "../../features/evolution/store/trace-store"
import { EvolutionWriter } from "../../features/evolution/writer"
import { log } from "../../shared/logger"
import { createSystemDirective } from "../../shared/system-directive"

export interface FlatContentPart {
  type?: string
  text?: string
  [key: string]: unknown
}

export interface FlatMessage {
  id?: string
  role?: string
  type?: string
  text?: string
  content?: FlatContentPart[]
  [key: string]: unknown
}

export interface FlatSessionEvent {
  readonly sessionID?: string
  readonly kind?: string
  readonly messages?: FlatMessage[] | unknown
  readonly [key: string]: unknown
}

export interface EvolutionHitlDeps {
  getState?: () => Promise<{ lastPromptAt?: string }>
  updateState?: (patch: { lastPromptAt: string }) => Promise<void>
  listPending?: () => Promise<string[]>
}

function messageRole(message: FlatMessage): string {
  if (typeof message.role === "string" && message.role.length > 0) return message.role
  if (typeof message.type === "string" && message.type.length > 0) return message.type
  return ""
}

function ensureContent(message: FlatMessage): FlatContentPart[] {
  if (!Array.isArray(message.content)) message.content = []
  return message.content
}

function appendText(message: FlatMessage, addition: string): void {
  if (typeof message.text === "string") {
    message.text = `${message.text}\n\n${addition}`
    return
  }
  const content = ensureContent(message)
  const block = content.find(
    (part) => part?.type === "text" && typeof part?.text === "string",
  )
  if (!block) {
    content.push({ type: "text", text: addition })
    return
  }
  block.text = `${block.text}\n\n${addition}`
}

function resolveConfig(a?: unknown, b?: unknown): EvolutionConfig | undefined {
  if (b && typeof b === "object" && "enabled" in (b as Record<string, unknown>)) return b as EvolutionConfig
  if (a && typeof a === "object" && "enabled" in (a as Record<string, unknown>)) return a as EvolutionConfig
  return undefined
}

export async function applyEvolutionHitl(
  event: FlatSessionEvent,
  a?: unknown,
  b?: unknown,
  deps?: EvolutionHitlDeps,
): Promise<void> {
  try {
    const config = resolveConfig(a, b)
    if (!config?.enabled) return
    if (!config.governance?.requireApproval) return
    const getState = deps?.getState ?? (() => traceStore.getState())
    const state = await getState()
    if (state.lastPromptAt) {
      const elapsed = Date.now() - new Date(state.lastPromptAt).getTime()
      if (!Number.isNaN(elapsed) && elapsed < 60 * 60 * 1000) return
    }
    let pending: string[] = []
    try {
      const listPending =
        deps?.listPending ?? (() => new EvolutionWriter(config.writer).listPending())
      pending = await listPending()
    } catch {
      return
    }
    if (pending.length === 0) return
    const slug = pending[0]
    const directive = createSystemDirective("EVOLUTION REVIEW")
    const content = `${directive}\n\n🧬 Evolution ready for review: ${slug} (${pending.length} pending). Preview: .matrixx/evolution/pending/${slug}.md\nRun /evolution approve ${slug} | /evolution reject ${slug} | /evolution list`
    const messages = Array.isArray(event?.messages) ? (event.messages as FlatMessage[]) : []
    if (messages.length === 0) return
    let lastUser: FlatMessage | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messageRole(messages[i]) === "user") {
        lastUser = messages[i]
        break
      }
    }
    if (!lastUser) return
    appendText(lastUser, content)
    const updateState = deps?.updateState ?? ((patch) => traceStore.updateState(patch))
    await updateState({ lastPromptAt: new Date().toISOString() })
    log("[evolution-hitl] injected pending review prompt", { slug, pendingCount: pending.length })
  } catch {}
}
