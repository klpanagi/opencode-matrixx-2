export const CONTEXT7_API_KEY_ENV = "CONTEXT7_API_KEY"

export interface Context7HealthInput {
  disabledMcps?: readonly string[]
  context7ApiKey?: string
}

export function buildContext7HealthNotice(
  input: Context7HealthInput = {},
): string | undefined {
  if ((input.disabledMcps ?? []).includes("context7")) return undefined
  if (input.context7ApiKey) return undefined

  return (
    "[mcp-startup] context7 MCP is enabled without CONTEXT7_API_KEY: anonymous requests are rate-limited and can fail silently.\n" +
    `→ fix: set ${CONTEXT7_API_KEY_ENV} to authenticate context7 (optional at low volume).`
  )
}
