export interface BuildContext7EntryInput {
  context7ApiKey?: string
}

export function buildContext7Entry(input: BuildContext7EntryInput = {}) {
  const key = input.context7ApiKey
  return {
    type: "remote" as const,
    url: "https://mcp.context7.com/mcp",
    enabled: true,
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    oauth: false as const,
  }
}

export const context7 = buildContext7Entry()
