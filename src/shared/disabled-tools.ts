import type { MatrixxToolDefinition } from "../tools/shared/define-tool"

export function filterDisabledTools(
  tools: Record<string, MatrixxToolDefinition>,
  disabledTools: readonly string[] | undefined
): Record<string, MatrixxToolDefinition> {
  if (!disabledTools || disabledTools.length === 0) {
    return tools
  }

  const disabledToolSet = new Set(disabledTools)
  const filtered: Record<string, MatrixxToolDefinition> = {}
  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (!disabledToolSet.has(toolName)) {
      filtered[toolName] = toolDefinition
    }
  }
  return filtered
}
