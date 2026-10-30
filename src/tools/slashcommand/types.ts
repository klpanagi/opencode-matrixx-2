import type { BuiltinSkill } from "../../skills"

  export interface LazyContentLoader {
  loaded: boolean
  content?: string
  load: () => Promise<string>
}

export type CommandScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project" | "plugin"

export interface CommandMetadata {
  name: string
  description: string
  argumentHint?: string
  model?: string
  agent?: string
  subtask?: boolean
}

export interface CommandInfo {
  name: string
  path?: string
  metadata: CommandMetadata
  content?: string
  scope: CommandScope
  lazyContentLoader?: LazyContentLoader
}

export interface PluginCommandEntry {
  name: string
  description?: string
  model?: unknown
  agent?: string
  subtask?: boolean
  template?: unknown
}

export interface PluginCommandClient {
  command: {
    list(): Promise<{ data?: PluginCommandEntry[] }>
  }
}

export interface SlashcommandToolOptions {
  /** Pre-loaded commands (skip discovery if provided) */
  commands?: CommandInfo[]
  /** Pre-loaded skills (skip discovery if provided) */
  skills?: BuiltinSkill[]
  /** Host command client for discovering plugin-registered commands */
  client?: PluginCommandClient
}
