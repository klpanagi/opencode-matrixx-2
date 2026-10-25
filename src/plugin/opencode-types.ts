/**
 * Minimal structural surface of the OpenCode V2 plugin API consumed by the
 * matrixx V2 adapter.
 *
 * We intentionally do not import `@opencode/plugin`: `Plugin.define` is an
 * identity helper and the loader only validates that the default export is an
 * object with `id` plus `setup` (see packages/core/src/plugin/module.ts). Local
 * structural types keep the port free of a runtime dependency that must match
 * the host OpenCode version exactly.
 */

export type Cleanup = () => unknown

export interface V2App {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export interface V2Project {
  readonly id: string
  readonly directory: string
  readonly canonical: string
}

export interface V2Location {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: V2Project
}

export interface V2Event {
  readonly type: string
  readonly [key: string]: unknown
}

export interface V2Registration {
  dispose(): Promise<void>
}

export type V2HookCallback<Event> = (event: Event) => Promise<void> | void

export interface V2SessionPromptEvent {
  readonly sessionID: string
  readonly messageID: string
  prompt: { text: string; [key: string]: unknown }
  metadata?: Record<string, unknown>
  delivery: string
}

export interface V2SystemPart {
  type: string
  text: string
}

export interface V2SessionContextEvent {
  readonly sessionID: string
  readonly agent: string
  readonly model: unknown
  system: V2SystemPart[]
  messages: unknown[]
  options: Record<string, unknown>
  tools: Record<string, { description: string; input: unknown }>
}

export interface V2SessionCompactionEvent extends V2SessionContextEvent {
  result?: unknown
}

export interface V2ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  progress(update: Record<string, unknown>): Promise<void>
}

export interface V2ToolResult {
  content?: string | ReadonlyArray<unknown>
  output?: unknown
  metadata?: Record<string, unknown>
}

export interface V2ToolInfo {
  name: string
  description: string
  input: unknown
  output?: unknown
  options?: Record<string, unknown>
  execute(input: unknown, context: V2ToolContext): Promise<V2ToolResult>
}

export interface V2ToolEditor {
  list(): ReadonlyArray<V2ToolInfo & { readonly id: string }>
  get(id: string): (V2ToolInfo & { readonly id: string }) | undefined
  namespace(namespace: { name: string; description: string }): void
  add(tool: V2ToolInfo): void
  update(id: string, update: (tool: V2ToolInfo) => void): void
  remove(id: string): void
}

export interface V2ExecuteBeforeEvent {
  tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  input: unknown
}

export type V2ExecuteAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly input: unknown
} & (
  | { readonly status: "completed"; result: V2ToolResult }
  | { readonly status: "error"; error: { message: string; [key: string]: unknown } }
)

export interface V2PermissionApi {
  assert(input: Record<string, unknown>): Promise<void>
  list(input: Record<string, unknown>): Promise<unknown>
  get(input: Record<string, unknown>): Promise<unknown>
  reply(input: Record<string, unknown>): Promise<void>
}

export interface V2ToolDomain {
  transform(callback: (editor: V2ToolEditor) => void): Promise<V2Registration>
  list(): Promise<ReadonlyArray<V2ToolInfo & { readonly id: string }>>
  reload(): Promise<void>
  hook(
    name: "execute.before",
    callback: V2HookCallback<V2ExecuteBeforeEvent>,
  ): Promise<V2Registration>
  hook(name: "execute.after", callback: V2HookCallback<V2ExecuteAfterEvent>): Promise<V2Registration>
}

export interface V2SessionDomain {
  hook(
    name: "prompt",
    callback: V2HookCallback<V2SessionPromptEvent>,
  ): Promise<V2Registration>
  hook(
    name: "context" | "compaction" | "generate" | "title",
    callback: V2HookCallback<V2SessionContextEvent>,
  ): Promise<V2Registration>
  hook(
    name: "model.request",
    callback: V2HookCallback<{ headers: Record<string, string>; [key: string]: unknown }>,
  ): Promise<V2Registration>
  list(input?: Record<string, unknown>): Promise<unknown>
  get(input: Record<string, unknown>): Promise<unknown>
  create(input?: Record<string, unknown>): Promise<unknown>
  update(input: Record<string, unknown>): Promise<unknown>
  move(input: Record<string, unknown>): Promise<unknown>
  remove(input: Record<string, unknown>): Promise<unknown>
  switchAgent(input: Record<string, unknown>): Promise<unknown>
  switchModel(input: Record<string, unknown>): Promise<unknown>
  prompt(input: Record<string, unknown>): Promise<unknown>
  generate(input: Record<string, unknown>): Promise<unknown>
  command(input: Record<string, unknown>): Promise<unknown>
  compact(input: Record<string, unknown>): Promise<unknown>
  synthetic(input: Record<string, unknown>): Promise<unknown>
  interrupt(input: Record<string, unknown>): Promise<unknown>
  wait(input: Record<string, unknown>): Promise<unknown>
  context(input: Record<string, unknown>): Promise<unknown>
}

export interface V2TransformDomain {
  list(input?: Record<string, unknown>): Promise<unknown>
  transform(callback: (editor: V2DomainEditor) => void): Promise<V2Registration>
  reload(): Promise<void>
}

/** Shared shape of the agent/command/mcp/skill/provider/model/reference editors. */
export interface V2DomainEditor {
  list(...args: unknown[]): ReadonlyArray<unknown>
  get(...args: unknown[]): unknown
  add(...args: unknown[]): void
  update(...args: unknown[]): void
  remove(...args: unknown[]): void
  [key: string]: unknown
}

export interface V2Context {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Record<string, unknown>
  readonly session: V2SessionDomain
  readonly tool: V2ToolDomain
  readonly event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<V2Event>
  }
  readonly agent: V2TransformDomain
  readonly command: V2TransformDomain
  readonly mcp: V2TransformDomain
  readonly skill: V2TransformDomain
  readonly model: V2TransformDomain
  readonly provider: V2TransformDomain
  readonly reference: V2TransformDomain
  readonly integration: V2TransformDomain
  readonly permission: V2PermissionApi
  readonly storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
  }
  readonly shell: {
    hook(
      name: "create.before",
      callback: V2HookCallback<{ env: Record<string, string>; [key: string]: unknown }>,
    ): Promise<V2Registration>
  }
}

export interface V2PluginDefinition {
  readonly id: string
  setup(context: V2Context): Promise<Cleanup | undefined> | Cleanup | undefined
}
