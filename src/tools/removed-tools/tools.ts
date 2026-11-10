import { defineTool, type MatrixxToolDefinition } from "../../shared/tool/define-tool"
import { REMOVED_TOOL_NAMES, type RemovedToolName } from "./constants"

export function buildRemovedToolMessage(name: RemovedToolName): string {
  return [
    `[ERROR] Tool \`${name}\` was removed.`,
    "Use the native `subagent` tool instead (agent=<name>, background=<true|false>, load_skills=[...]).",
    "Cancel or wait on a running child via `subagent_control` (action=cancel|wait, session_id=<child sessionID>).",
    "Read child output via `session_read` / `session_search` / `session_info`.",
  ].join(" ")
}

export function createRemovedToolGuard(name: RemovedToolName): MatrixxToolDefinition {
  return defineTool(name, {
    description: `Removed delegation tool. Use native subagent + subagent_control instead.`,
    args: {},
    async execute() {
      return buildRemovedToolMessage(name)
    },
  })
}

export const REMOVED_TOOL_GUARDS: MatrixxToolDefinition[] = REMOVED_TOOL_NAMES.map((name) =>
  createRemovedToolGuard(name),
)

