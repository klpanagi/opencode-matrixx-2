import type { McpCreationFailure } from "./mcp-validator"

let startupFailures: McpCreationFailure[] = []

export function setMcpStartupFailures(failures: McpCreationFailure[]): void {
  startupFailures = failures
}

export function getMcpStartupFailures(): McpCreationFailure[] {
  return startupFailures
}

export function _resetMcpStartupFailuresForTesting(): void {
  startupFailures = []
}

let startupWarnings: string[] = []

export function setMcpStartupWarnings(warnings: string[]): void {
  startupWarnings = warnings
}

export function getMcpStartupWarnings(): string[] {
  return startupWarnings
}

export function _resetMcpStartupWarningsForTesting(): void {
  startupWarnings = []
}
