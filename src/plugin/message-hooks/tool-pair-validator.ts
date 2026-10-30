/**
 * Tool call/result pair validator — flat `Message[]` port (Task 26, Group C).
 *
 * Behavior parity with `src/hooks/tool-pair-validator/hook.ts`: every assistant
 * message's tool calls (`tool_use` by `id`, AssistantTool `tool` blocks by
 * `callID`) must have a matching `tool_result` in the next user message. A
 * missing result is inserted there; when the next message is not a user message
 * a synthetic `{ role: "user" }` message is spliced in. Operates on the V2 flat
 * shape (`role` + `content`); messages without an array `content` never throw.
 */

import { log } from "../../shared/logger"
import type { MatrixxContext, V2Registration, V2SessionContextEvent } from "../context"

const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)"

/** Minimal flat content block (tool calls, results, and text). */
export type FlatContentBlock = {
  readonly type?: unknown
  readonly id?: unknown
  readonly callID?: unknown
  readonly tool_use_id?: unknown
  readonly content?: unknown
  [key: string]: unknown
}

/** Minimal flat message (`role` + `content`, never `{info, parts}`). */
export type FlatMessage = {
  id?: unknown
  role?: unknown
  content?: unknown
  sessionID?: unknown
  [key: string]: unknown
}

type ToolResultBlock = {
  type: "tool_result"
  tool_use_id: string
  content: string
  [key: string]: unknown
}

function getRole(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined
  const role = (message as { role?: unknown }).role
  return typeof role === "string" ? role : undefined
}

function getToolUseID(block: unknown): string | null {
  if (typeof block !== "object" || block === null) return null
  const candidate = block as { type?: unknown; id?: unknown; callID?: unknown }
  if (candidate.type === "tool_use" && typeof candidate.id === "string" && candidate.id.length > 0) {
    return candidate.id
  }
  if (candidate.type === "tool" && typeof candidate.callID === "string" && candidate.callID.length > 0) {
    return candidate.callID
  }
  return null
}

function getToolResultID(block: unknown): string | null {
  if (typeof block !== "object" || block === null) return null
  const candidate = block as { type?: unknown; tool_use_id?: unknown }
  if (
    candidate.type === "tool_result" &&
    typeof candidate.tool_use_id === "string" &&
    candidate.tool_use_id.length > 0
  ) {
    return candidate.tool_use_id
  }
  return null
}

function blocksOf(message: FlatMessage): unknown[] {
  return Array.isArray(message.content) ? message.content : []
}

function extractUniqueToolUseIDs(blocks: unknown[]): string[] {
  const seen = new Set<string>()
  const toolUseIDs: string[] = []
  for (const block of blocks) {
    const id = getToolUseID(block)
    if (!id || seen.has(id)) continue
    seen.add(id)
    toolUseIDs.push(id)
  }
  return toolUseIDs
}

function extractToolResultIDs(blocks: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    const id = getToolResultID(block)
    if (id) ids.add(id)
  }
  return ids
}

function createToolResultBlock(toolUseID: string): ToolResultBlock {
  return { type: "tool_result", tool_use_id: toolUseID, content: TOOL_RESULT_PLACEHOLDER }
}

function findToolResultInsertIndex(blocks: unknown[]): number {
  let lastIndex = -1
  for (let i = 0; i < blocks.length; i++) {
    if (getToolResultID(blocks[i])) lastIndex = i
  }
  return lastIndex === -1 ? 0 : lastIndex + 1
}

function ensureContentArray(message: FlatMessage): unknown[] {
  if (!Array.isArray(message.content)) message.content = []
  return message.content as unknown[]
}

function insertMissingToolResults(message: FlatMessage, missingIDs: string[]): void {
  const blocks = ensureContentArray(message)
  const insertIndex = findToolResultInsertIndex(blocks)
  blocks.splice(insertIndex, 0, ...missingIDs.map(createToolResultBlock))
}

function createSyntheticUserMessage(assistantMessage: FlatMessage, missingIDs: string[]): FlatMessage {
  const sessionID = assistantMessage.sessionID
  return {
    role: "user",
    ...(typeof sessionID === "string" ? { sessionID } : {}),
    content: missingIDs.map(createToolResultBlock),
  }
}

function getMessageID(message: FlatMessage): string | undefined {
  return typeof message.id === "string" ? message.id : undefined
}

function repairMissingToolResults(messages: FlatMessage[], assistantIndex: number): void {
  const assistantMessage = messages[assistantIndex]
  if (typeof assistantMessage !== "object" || assistantMessage === null) return
  const toolUseIDs = extractUniqueToolUseIDs(blocksOf(assistantMessage))
  if (toolUseIDs.length === 0) return

  const nextMessage = messages[assistantIndex + 1]
  if (getRole(nextMessage) !== "user") {
    messages.splice(assistantIndex + 1, 0, createSyntheticUserMessage(assistantMessage, toolUseIDs))
    log("[tool-pair-validator] Repaired missing tool_result blocks", {
      assistantMessageID: getMessageID(assistantMessage),
      syntheticUserMessageInserted: true,
      repairedToolUseIDs: toolUseIDs,
    })
    return
  }

  const next = nextMessage as FlatMessage
  const existingResultIDs = extractToolResultIDs(blocksOf(next))
  const missingIDs = toolUseIDs.filter((id) => !existingResultIDs.has(id))
  if (missingIDs.length === 0) return

  insertMissingToolResults(next, missingIDs)
  log("[tool-pair-validator] Repaired missing tool_result blocks", {
    assistantMessageID: getMessageID(assistantMessage),
    syntheticUserMessageInserted: false,
    repairedToolUseIDs: missingIDs,
  })
}

/**
 * Repair every assistant message's unmatched tool calls in place, in order.
 * Empty input is a no-op; messages without an array `content` never throw.
 */
export function repairToolPairMessages(messages: FlatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    if (getRole(messages[i]) !== "assistant") continue
    repairMissingToolResults(messages, i)
  }
}

/**
 * Native session-hook entry point: mutates `event.messages` in place.
 * A missing or non-array `messages` is a silent no-op (fail-open). The same
 * entry point serves both `context` and `generate` registrations — auxiliary
 * requests bypass `context`, so `generate` coverage is what keeps them paired.
 */
export async function handleToolPairValidatorEvent(event: V2SessionContextEvent): Promise<void> {
  if (!Array.isArray(event.messages)) return
  repairToolPairMessages(event.messages as FlatMessage[])
}

/**
 * Register the native entry point on every kind in its mapping-table row
 * (`toolPairValidator` -> `context`, `generate`). The same entry point serves
 * both registrations — auxiliary requests bypass `context`, so `generate`
 * coverage is what keeps them paired.
 */
export async function registerToolPairValidator(_ctx: MatrixxContext): Promise<V2Registration[]> {
  const registrations: V2Registration[] = []
  for (const kind of ["context", "generate"] as const) {
    registrations.push(
      await _ctx.session.hook(kind, async (event) => {
        await handleToolPairValidatorEvent(event)
      }),
    )
  }
  return registrations
}