export interface FlatContentPart {
  type?: string
  text?: string
  thinking?: string
  synthetic?: boolean
  [key: string]: unknown
}

export interface FlatMessage {
  id?: string
  role?: string
  type?: string
  text?: string
  content?: FlatContentPart[]
  model?: unknown
  [key: string]: unknown
}

export interface FlatSessionEvent {
  readonly sessionID?: string
  readonly kind?: string
  readonly model?: unknown
  readonly messages?: FlatMessage[] | unknown
  readonly [key: string]: unknown
}

function messageRole(message: FlatMessage): string {
  if (typeof message.role === "string" && message.role.length > 0) return message.role
  if (typeof message.type === "string" && message.type.length > 0) return message.type
  return ""
}

function contentOf(message: FlatMessage): FlatContentPart[] {
  return Array.isArray(message.content) ? message.content : []
}

function ensureContent(message: FlatMessage): FlatContentPart[] {
  if (!Array.isArray(message.content)) message.content = []
  return message.content
}

function modelIDOf(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const modelID = record.modelID
    if (typeof modelID === "string" && modelID.length > 0) return modelID
    const id = record.id
    if (typeof id === "string" && id.length > 0) return id
  }
  return ""
}

function resolveModelID(event: FlatSessionEvent, lastUserMessage?: FlatMessage): string {
  const fromEvent = modelIDOf(event?.model)
  if (fromEvent.length > 0) return fromEvent
  const fromMessage = modelIDOf(lastUserMessage?.model)
  if (fromMessage.length > 0) return fromMessage
  return ""
}

function isExtendedThinkingModel(modelID: string): boolean {
  if (!modelID) return false
  const lower = modelID.toLowerCase()

  if (lower.includes("thinking") || lower.endsWith("-high")) {
    return true
  }

  return (
    lower.includes("claude-sonnet-4") ||
    lower.includes("claude-opus-4") ||
    lower.includes("claude-3")
  )
}

function hasContentParts(parts: FlatContentPart[]): boolean {
  if (!parts || parts.length === 0) return false

  return parts.some((part: FlatContentPart) => {
    const type = part?.type
    return type === "tool" || type === "tool_use" || type === "text"
  })
}

function startsWithThinkingBlock(parts: FlatContentPart[]): boolean {
  if (!parts || parts.length === 0) return false

  const firstType = parts[0]?.type
  return firstType === "thinking" || firstType === "reasoning"
}

function prependThinkingBlock(message: FlatMessage, thinkingContent: string): void {
  const content = ensureContent(message)
  content.unshift({ type: "thinking", thinking: thinkingContent, synthetic: true })
}

export async function applyThinkingBlockValidator(event: FlatSessionEvent): Promise<void> {
  const messages = Array.isArray(event?.messages) ? (event.messages as FlatMessage[]) : []
  if (messages.length === 0) return

  const lastUserMessage = messages.findLast((message) => messageRole(message) === "user")
  const modelID = resolveModelID(event, lastUserMessage)

  if (!isExtendedThinkingModel(modelID)) return

  let lastThinkingContent = ""

  for (const message of messages) {
    if (messageRole(message) === "assistant") {
      for (const part of contentOf(message)) {
        const type = part?.type
        if (type === "thinking" || type === "reasoning") {
          const thinking = part?.thinking ?? part?.text
          if (typeof thinking === "string" && thinking.trim().length > 0) {
            lastThinkingContent = thinking
          }
        }
      }
    }

    if (messageRole(message) !== "assistant") continue

    const parts = contentOf(message)
    if (hasContentParts(parts) && !startsWithThinkingBlock(parts)) {
      const thinkingContent = lastThinkingContent || "[Continuing from previous reasoning]"
      prependThinkingBlock(message, thinkingContent)
    }
  }
}
