/**
 * Local copy of the V1 host hook map (`Hooks` from the V1 plugin package).
 *
 * Task 24 relocation: every `import type { Hooks } from "./legacy-hooks"`
 * now resolves here instead of the V1 package, so the substrate deletion does
 * not change behavior. The shape is verbatim (only `MatrixxToolDefinition` points at
 * `MatrixxToolDefinition`); tasks 25-27 replace these fragments with native
 * `session.hook(...)` registrations and then this module goes away.
 */
// Task 28: local structural aliases (the V1 SDK is no longer a dependency).
// Each alias mirrors only what the hook map below references.
export type Auth = Record<string, unknown>
export type Event = Record<string, unknown> & { type?: string }
export type Message = Record<string, unknown>
export type Model = Record<string, unknown> & { providerID?: string; modelID?: string }
export type Part = { type: string; text?: string; [key: string]: unknown }
export type Permission = Record<string, unknown>
export type Provider = Record<string, unknown>
export type SDKConfig = Record<string, unknown>
export type UserMessage = Record<string, unknown>
export type ModelV2 = Record<string, unknown>
export type ProviderV2 = Record<string, unknown>

import type { MatrixxToolDefinition } from "../tools/shared/define-tool"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, unknown>
}

export interface Hooks {
  event?: (input: {
    event: Event
  }) => Promise<void>
  config?: (input: SDKConfig) => Promise<void>
  tool?: {
    [key: string]: MatrixxToolDefinition
  }
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: {
        providerID: string
        modelID: string
      }
      messageID?: string
      variant?: string
    },
    output: {
      message: UserMessage
      parts: Part[]
    },
  ) => Promise<void>
  "chat.params"?: (
    input: {
      sessionID: string
      agent: string
      model: Model
      provider: ProviderContext
      message: UserMessage
    },
    output: {
      temperature: number
      topP: number
      topK: number
      options: Record<string, unknown>
    },
  ) => Promise<void>
  "chat.headers"?: (
    input: {
      sessionID: string
      agent: string
      model: Model
      provider: ProviderContext
      message: UserMessage
    },
    output: {
      headers: Record<string, string>
    },
  ) => Promise<void>
  "permission.ask"?: (
    input: Permission,
    output: {
      status: "ask" | "deny" | "allow"
    },
  ) => Promise<void>
  "command.execute.before"?: (
    input: {
      command: string
      sessionID: string
      arguments: string
    },
    output: {
      parts: Part[]
    },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: {
      tool: string
      sessionID: string
      callID: string
    },
    output: {
      args: any
    },
  ) => Promise<void>
  "shell.env"?: (
    input: {
      cwd: string
      sessionID?: string
      callID?: string
    },
    output: {
      env: Record<string, string>
    },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: {
      tool: string
      sessionID: string
      callID: string
      args: any
    },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message;
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: {
      sessionID?: string
      model: Model
    },
    output: {
      system: string[]
    },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: {
      sessionID: string
    },
    output: {
      context: string[]
      prompt?: string
    },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: {
      sessionID: string
      messageID: string
      partID: string
    },
    output: {
      text: string
    },
  ) => Promise<void>
  "tool.definition"?: (
    input: {
      toolID: string
    },
    output: {
      description: string
      parameters: any
    },
  ) => Promise<void>
}

