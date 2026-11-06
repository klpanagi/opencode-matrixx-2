export type ContentPart = { type?: string; text?: string; [key: string]: unknown }

export type SessionRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "synthetic"
  | "skill"
  | "shell"
  | "compaction"
  | "idle"
  | "agent-switched"
  | "model-switched"
  | "location-switched"
  | "unknown"

export type SessionMessage = {
  id?: string
  type?: string
  time?: { created?: number }
  text?: string
  content?: ReadonlyArray<ContentPart>
  finish?: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  error?: unknown
}

const KNOWN_ROLES: ReadonlySet<string> = new Set<SessionRole>([
  "user",
  "assistant",
  "system",
  "tool",
  "synthetic",
  "skill",
  "shell",
  "compaction",
  "idle",
  "agent-switched",
  "model-switched",
  "location-switched",
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

export function roleOf(message: unknown): SessionRole {
  const type = asRecord(message)?.type
  if (typeof type !== "string") return "unknown"
  return KNOWN_ROLES.has(type) ? (type as SessionRole) : "unknown"
}

export function contentOf(message: unknown): ReadonlyArray<ContentPart> {
  const content = asRecord(message)?.content
  return Array.isArray(content) ? (content as ContentPart[]) : []
}

export function textOf(message: unknown): string {
  const record = asRecord(message)
  if (!record) return ""
  if (roleOf(record) !== "assistant") {
    return typeof record.text === "string" ? record.text : ""
  }
  return contentOf(record)
    .filter((block) => block.type === "text" || block.type === "reasoning")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n")
}

export function finishOf(message: unknown): string | undefined {
  const finish = asRecord(message)?.finish
  return typeof finish === "string" ? finish : undefined
}

export function idOf(message: unknown): string | undefined {
  const id = asRecord(message)?.id
  return typeof id === "string" ? id : undefined
}

export function timeOf(message: unknown): number {
  const created = asRecord(asRecord(message)?.time)?.created
  return typeof created === "number" ? created : 0
}

export function isAssistant(message: unknown): boolean {
  return roleOf(message) === "assistant"
}

