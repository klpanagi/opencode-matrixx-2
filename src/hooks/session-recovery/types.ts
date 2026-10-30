import type { SessionMessage } from "../../shared/session-message"
import type { TaskStatus } from "../../shared/status-types"

export interface StoredMessageMeta {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time?: {
    created: number
    completed?: number
  }
  error?: unknown
}

export interface StoredTextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
}

export interface StoredToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: {
    status: TaskStatus
    input: Record<string, unknown>
    output?: string
    error?: string
  }
}

interface StoredReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

interface StoredStepPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-start" | "step-finish"
}

export type StoredPart = StoredTextPart | StoredToolPart | StoredReasoningPart | StoredStepPart | {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

export type MessageData = SessionMessage

export interface ResumeConfig {
  sessionID: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
}
