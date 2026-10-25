export interface McpCreationFailure {
  name: string
  error: string
}

export type McpValidationResult = { ok: true } | { ok: false; error: string }

export function isCommandAvailable(command: string): boolean {
  try {
    const result = Bun.spawnSync([command, "--version"], { stdout: "pipe", stderr: "pipe" })
    return result.exitCode === 0
  } catch {
    return false
  }
}
