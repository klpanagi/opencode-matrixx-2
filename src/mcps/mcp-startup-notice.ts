import { getMcpStartupFailures, getMcpStartupWarnings } from "./mcp-startup-state"
import type { McpCreationFailure } from "./mcp-validator"

export const MCP_UVX_INSTALL_FIX = "curl -LsSf https://astral.sh/uv/install.sh | sh"
export const MCP_UVX_WARM_FIX = "uvx --from markitdown-mcp markitdown-mcp --help"

function buildFailureLine(failure: McpCreationFailure): string {
  if (failure.name === "document_reader") {
    return (
      "[mcp-startup] document_reader MCP is disabled: uvx (uv package manager) not found in PATH, " +
      "so document_reader_convert_to_markdown is unavailable.\n" +
      `→ fix: Install uv/uvx: ${MCP_UVX_INSTALL_FIX}\n` +
      `Then warm cache: ${MCP_UVX_WARM_FIX}`
    )
  }
  return `[mcp-startup] ${failure.name} MCP is disabled: ${failure.error}`
}

export function buildMcpStartupNotice(
  failures: McpCreationFailure[],
  warnings: string[] = [],
): string | undefined {
  const lines = [...failures.map(buildFailureLine), ...warnings].filter(
    (line) => line.length > 0,
  )
  if (lines.length === 0) return undefined
  return lines.join("\n")
}

export function getMcpStartupNotice(): string | undefined {
  return buildMcpStartupNotice(getMcpStartupFailures(), getMcpStartupWarnings())
}
