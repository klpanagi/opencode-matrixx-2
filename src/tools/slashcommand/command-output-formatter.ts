import { dirname } from "node:path"
import {
  buildExpansionSecurity,
  type CommandExpansionSecurity,
  log,
  resolveCommandsInText,
  resolveFileReferencesInText,
} from "../../shared"
import type { CommandInfo } from "./types"

export interface FormatLoadedCommandOptions {
  security?: CommandExpansionSecurity
  execFn?: (command: string) => Promise<string>
}

export async function formatLoadedCommand(
  command: CommandInfo,
  userMessage?: string,
  options?: FormatLoadedCommandOptions
): Promise<string> {
  const sections: string[] = []

  sections.push(`# /${command.name} Command\n`)

  if (command.metadata.description) {
    sections.push(`**Description**: ${command.metadata.description}\n`)
  }

  if (command.metadata.argumentHint) {
    sections.push(`**Usage**: /${command.name} ${command.metadata.argumentHint}\n`)
  }

  if (userMessage) {
    sections.push(`**Arguments**: ${userMessage}\n`)
  }

  if (command.metadata.model) {
    sections.push(`**Model**: ${command.metadata.model}\n`)
  }

  if (command.metadata.agent) {
    sections.push(`**Agent**: ${command.metadata.agent}\n`)
  }

  if (command.metadata.subtask) {
    sections.push("**Subtask**: true\n")
  }

  sections.push(`**Scope**: ${command.scope}\n`)
  sections.push("---\n")
  sections.push("## Command Instructions\n")

  let content = command.content || ""
  if (!content && command.lazyContentLoader) {
    content = await command.lazyContentLoader.load()
  }

  const commandDir = command.path ? dirname(command.path) : process.cwd()
  const { policy, allowFileRefs } = buildExpansionSecurity(command.scope, command.name, options?.security)
  const withFileReferences = await resolveFileReferencesInText(content, {
    cwd: commandDir,
    allowFileRefs,
    maxBytes: options?.security?.file_reference?.max_bytes,
    maxTotalBytes: options?.security?.file_reference?.max_total_bytes,
  })
  const resolvedContent = await resolveCommandsInText(withFileReferences, {
    policy,
    execFn: options?.execFn,
    onBlocked: () =>
      log("[command-expansion] Blocked shell expansion", { command: command.name, scope: command.scope }),
  })

  let finalContent = resolvedContent.trim()
  const args = userMessage ?? ""
  finalContent = finalContent.replace(/\$ARGUMENTS/g, args)
  if (userMessage) {
    finalContent = finalContent.replace(/\$\{user_message\}/g, userMessage)
  }

  sections.push(finalContent)
  return sections.join("\n")
}

export function formatCommandList(items: CommandInfo[]): string {
  if (items.length === 0) return "No commands or skills found."

  const lines = ["# Available Commands & Skills\n"]

  for (const command of items) {
    const hint = command.metadata.argumentHint ? ` ${command.metadata.argumentHint}` : ""
    lines.push(
      `- **/${command.name}${hint}**: ${command.metadata.description || "(no description)"} (${command.scope})`
    )
  }

  lines.push(`\n**Total**: ${items.length} items`)
  return lines.join("\n")
}
