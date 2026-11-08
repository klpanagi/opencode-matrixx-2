import { DEFAULT_MAX_BYTES, DEFAULT_MAX_MESSAGES } from "./constants"
import type { EffortCoverage, EffortTelemetry } from "./types"

export interface CollectTiming {
  durationMs?: number
}

export interface CollectResult {
  telemetry: EffortTelemetry
  coverage: EffortCoverage
  missing: string[]
}

interface TokenBlock {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface ContentPart {
  type?: unknown
  tool?: unknown
  name?: unknown
  toolName?: unknown
}

const TOOL_PART_TYPES = new Set(["tool", "tool-invocation", "tool_use", "tool-call"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

// Tokens live either on message.info.tokens or directly on message.tokens; the first
// holder with all six numeric fields wins (mirrors tokensOf in dynamic-truncator).
function tokensOf(message: unknown): TokenBlock | undefined {
  if (!isRecord(message)) return undefined
  const info = isRecord(message.info) ? message.info : undefined
  const holders = [isRecord(info) && isRecord(info.tokens) ? info.tokens : undefined, info, message.tokens]
  for (const holder of holders) {
    if (!isRecord(holder)) continue
    const candidate = holder as { input?: unknown; output?: unknown; reasoning?: unknown; cache?: unknown }
    if (!finite(candidate.input) || !finite(candidate.output) || !finite(candidate.reasoning)) continue
    if (!isRecord(candidate.cache)) continue
    if (!finite(candidate.cache.read) || !finite(candidate.cache.write)) continue
    return {
      input: candidate.input,
      output: candidate.output,
      reasoning: candidate.reasoning,
      cache: { read: candidate.cache.read, write: candidate.cache.write },
    }
  }
  return undefined
}

function isAssistant(message: unknown): boolean {
  if (!isRecord(message)) return false
  if (message.type === "assistant") return true
  return isRecord(message.info) && message.info.role === "assistant"
}

function contentPartsOf(message: unknown): ContentPart[] {
  if (!isRecord(message)) return []
  const parts: ContentPart[] = []
  if (Array.isArray(message.content)) parts.push(...(message.content as ContentPart[]))
  if (isRecord(message.info) && Array.isArray(message.info.content)) {
    parts.push(...(message.info.content as ContentPart[]))
  }
  return parts
}

function toolNameOf(part: ContentPart): string {
  if (typeof part.tool === "string") return part.tool
  if (typeof part.name === "string") return part.name
  if (typeof part.toolName === "string") return part.toolName
  return "unknown"
}

function hasError(message: unknown): boolean {
  if (!isRecord(message)) return false
  if (message.error !== undefined && message.error !== null) return true
  return isRecord(message.info) && message.info.error !== undefined && message.info.error !== null
}

function createdOf(message: unknown): number | undefined {
  if (!isRecord(message)) return undefined
  const direct = isRecord(message.time) ? message.time.created : undefined
  if (finite(direct)) return direct
  const nested = isRecord(message.info) && isRecord(message.info.time) ? message.info.time.created : undefined
  return finite(nested) ? nested : undefined
}

// Byte cap uses the serialized size so pathological payloads cannot blow memory.
function byteLengthOf(message: unknown): number {
  try {
    const json = JSON.stringify(message)
    return typeof json === "string" ? new TextEncoder().encode(json).length : 0
  } catch {
    return 0
  }
}

function boundedMessages(messages: unknown[], missing: string[]): { messages: unknown[]; truncated: boolean } {
  let truncated = false
  let selected = messages
  if (selected.length > DEFAULT_MAX_MESSAGES) {
    selected = selected.slice(-DEFAULT_MAX_MESSAGES)
    missing.push("truncated:messages")
    truncated = true
  }
  const kept: unknown[] = []
  let bytes = 0
  for (const message of selected) {
    const size = byteLengthOf(message)
    if (bytes + size > DEFAULT_MAX_BYTES) {
      missing.push("truncated:bytes")
      truncated = true
      break
    }
    bytes += size
    kept.push(message)
  }
  return { messages: kept, truncated }
}

function durationOf(messages: unknown[], timing: CollectTiming | undefined): number {
  if (timing && finite(timing.durationMs) && timing.durationMs >= 0) return timing.durationMs
  const stamps = messages.map(createdOf).filter((value): value is number => value !== undefined)
  if (stamps.length < 2) return 0
  const first = stamps[0]
  const last = stamps[stamps.length - 1]
  return last >= first ? last - first : 0
}

function nonNegative(value: number): number {
  return finite(value) && value >= 0 ? value : 0
}

export function collectTelemetry(messages: unknown[], timing?: CollectTiming): CollectResult {
  const missing: string[] = []
  const bounded = boundedMessages(Array.isArray(messages) ? messages : [], missing)

  const telemetry: EffortTelemetry = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    steps: 0,
    toolCalls: 0,
    uniqueTools: 0,
    retries: 0,
    durationMs: durationOf(bounded.messages, timing),
  }

  const tools = new Set<string>()
  let missingTokens = false

  for (const message of bounded.messages) {
    const assistant = isAssistant(message)
    if (assistant) telemetry.steps += 1

    if (assistant) {
      const tokens = tokensOf(message)
      if (tokens) {
        telemetry.input += tokens.input
        telemetry.output += tokens.output
        telemetry.reasoning += tokens.reasoning
        telemetry.cacheRead += tokens.cache.read
        telemetry.cacheWrite += tokens.cache.write
      } else {
        missingTokens = true
      }
    }

    for (const part of contentPartsOf(message)) {
      if (typeof part.type !== "string" || !TOOL_PART_TYPES.has(part.type)) continue
      telemetry.toolCalls += 1
      tools.add(toolNameOf(part))
    }

    if (hasError(message)) telemetry.retries += 1
  }

  if (missingTokens) missing.push("tokens")
  telemetry.uniqueTools = tools.size

  for (const key of Object.keys(telemetry) as Array<keyof EffortTelemetry>) {
    telemetry[key] = nonNegative(telemetry[key])
  }

  return {
    telemetry,
    coverage: missing.length > 0 ? "partial" : "full",
    missing,
  }
}
