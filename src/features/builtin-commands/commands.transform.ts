/**
 * V2-native command domain transform (D4).
 *
 * Owned by `src/features/builtin-commands/`: pure entry builder +
 * single `ctx.command.transform` registration. No filesystem access, no spawn,
 * no network — the definitions record in `./commands` is static data, so
 * repeated runs over the same disabled set replay identically.
 */

import type { CommandDefinition } from "../command-loader"
import { BUILTIN_COMMAND_DEFINITIONS } from "./commands"
import type { BuiltinCommandName, BuiltinCommands } from "./types"

/** Pure: builtin command entries for a given disabled set. */
export function buildBuiltinCommandEntries(
  disabledCommands?: BuiltinCommandName[],
): BuiltinCommands {
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(BUILTIN_COMMAND_DEFINITIONS)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export function evaluateCommandTemplate(template: string, input: string): string {
  const args = (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  const last = Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
  const expanded = template.replaceAll(placeholderRegex, (_match: string, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    const value = args[argIndex]
    return value === undefined ? "" : value
  })
  const withArguments = expanded.replaceAll("$ARGUMENTS", () => input)
  if (placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()) {
    return `${withArguments}\n\n${input}`.trim()
  }
  return withArguments.trim()
}

export interface CommandInvocation {
  sessionID: string
  prompt?: { text?: string }
  text?: string
  delivery?: string
}

export interface CommandSessionDeps {
  switchAgent?: (input: Record<string, unknown>) => Promise<unknown>
  switchModel?: (input: Record<string, unknown>) => Promise<unknown>
  prompt?: (input: Record<string, unknown>) => Promise<unknown>
  create?: (input: Record<string, unknown>) => Promise<unknown>
}

export interface CommandAgentDeps {
  get?: (input: Record<string, unknown>) => Promise<unknown>
}

export interface RegisterCommandTransformDeps {
  session?: CommandSessionDeps
  agent?: CommandAgentDeps
}

export interface CommandDefinitionInput {
  name: string
  description?: string
  execute: (input: CommandInvocation) => Promise<void>
  [key: string]: unknown
}

/** Minimal structural editor: the real V2 command editor satisfies this. */
export interface CommandTransformEditor {
  add(def: CommandDefinitionInput): void
}

export interface CommandTransformDomain {
  transform(callback: (editor: CommandTransformEditor) => void): Promise<unknown>
}

export interface RegisterCommandTransformResult {
  registration: unknown
  /** Command names replayed onto the domain. */
  registered: string[]
}

function isModelObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.model === "string" || typeof record.providerID === "string"
}

/**
 * Pure replay: command entries → `ctx.command.transform`.
 * The only effect is the single `transform` call; the callback only calls
 * `editor.add`, so re-running over the same entries replays identically.
 */
export async function registerCommandTransform(
  command: CommandTransformDomain,
  entries: Record<string, unknown> | undefined,
  deps?: RegisterCommandTransformDeps,
): Promise<RegisterCommandTransformResult> {
  const registered: string[] = []
  const session = deps?.session
  const registration = await command.transform((editor) => {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      const record: Record<string, unknown> =
        entry !== null && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {}
      const resolvedName = typeof record.name === "string" ? record.name : name
      const description = typeof record.description === "string" ? record.description : undefined
      const template = typeof record.template === "string" ? record.template : ""
      const agentName =
        typeof record.agent === "string" && record.agent.length > 0 ? record.agent : undefined
      const modelValue: unknown = record.model
      const hasObjectModel = isModelObject(modelValue)
      const execute = async (invocation: CommandInvocation): Promise<void> => {
        const promptText = invocation.prompt?.text ?? invocation.text ?? ""
        const text = evaluateCommandTemplate(template, promptText)
        if (!session) {
          throw new Error(`command "${resolvedName}" requires a session client`)
        }
        if (agentName && session.switchAgent) {
          await session.switchAgent({ sessionID: invocation.sessionID, agent: agentName })
        }
        if (hasObjectModel && session.switchModel) {
          await session.switchModel({ sessionID: invocation.sessionID, model: modelValue })
        }
        if (!session.prompt) {
          throw new Error(`command "${resolvedName}" requires a session client`)
        }
        await session.prompt({
          sessionID: invocation.sessionID,
          text,
          delivery: invocation.delivery,
        })
      }
      const def: CommandDefinitionInput = {
        ...record,
        name: resolvedName,
        execute,
      }
      if (description !== undefined) def.description = description
      editor.add(def)
      registered.push(name)
    }
  })
  return { registration, registered }
}
