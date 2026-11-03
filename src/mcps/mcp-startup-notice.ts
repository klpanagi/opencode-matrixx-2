import { getMcpStartupFailures } from "./mcp-startup-state"
import type { McpCreationFailure } from "./mcp-validator"

export const MCP_UVX_INSTALL_FIX = "curl -LsSf https://astral.sh/uv/install.sh | sh"
export const MCP_UVX_WARM_FIX = "uvx --from markitdown-mcp markitdown-mcp --help"

function buildFailureLine(failure: McpCreationFailure): string {
  if (failure.name === "document_reader") {
    return (
      "[mcp-startup] document_reader MCP is disabled: uvx (uv package manager) not found in PATH, " +
      "so document_reader__convert_to_markdown is unavailable.\n" +
      `→ fix: Install uv/uvx: ${MCP_UVX_INSTALL_FIX}\n` +
      `Then warm cache: ${MCP_UVX_WARM_FIX}`
    )
  }
  return `[mcp-startup] ${failure.name} MCP is disabled: ${failure.error}`
}

export function buildMcpStartupNotice(failures: McpCreationFailure[]): string | undefined {
  if (failures.length === 0) return undefined
  return failures.map(buildFailureLine).join("\n")
}

export function getMcpStartupNotice(): string | undefined {
  return buildMcpStartupNotice(getMcpStartupFailures())
}
