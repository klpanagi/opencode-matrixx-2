import { createEnvContext } from "../../agents/env-context"
import type { MatrixxContext } from "../../plugin/context"
import { notifyInjection } from "../../shared/injection-notifier"

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
  readonly system?: unknown
  readonly [key: string]: unknown
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

export async function applyEnvContextInjector(
  event: FlatSessionEvent,
  ctx?: MatrixxContext,
): Promise<void> {
  const messages = Array.isArray(event?.messages) ? (event.messages as FlatMessage[]) : []
  if (messages.length === 0) return

  let lastUserMessage: FlatMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messageRole(messages[i]) === "user") {
      lastUserMessage = messages[i]
      break
    }
  }
  if (!lastUserMessage) return

  const envContext = createEnvContext()
  appendText(lastUserMessage, envContext)

  const sessionID = event?.sessionID
  if (ctx && typeof sessionID === "string" && sessionID.length > 0) {
    await notifyInjection(ctx, {
      sessionID,
      injector: "env-context-injector",
      hash: envContext,
      title: "Context injection",
      message: "Environment context applied",
    })
  }
}
