# MCP KNOWLEDGE BASE

## OVERVIEW

Tier 1 of two-tier MCP system: 2 built-in MCPs (1 remote HTTP + 1 local stdio).

**Two-Tier System**:
1. **Built-in** (this directory): context7, document_reader
2. **Plugin-config / user-configured**: MCPs defined in plugin configuration

## STRUCTURE
```
mcp/
├── index.ts           # createBuiltinMcps() factory
├── index.test.ts      # Tests
├── context7.ts        # Library documentation
├── document-reader.ts # Microsoft MarkItDown (PDF, DOCX, XLSX, PPTX, images)
└── types.ts           # McpNameSchema
```

## MCP SERVERS

| Name | Transport | Auth | Purpose |
|------|-----------|------|---------|
| context7 | remote HTTP | CONTEXT7_API_KEY (optional) | Library docs lookup |
| document_reader | local stdio (`uvx`) | None | Read PDF/DOCX/XLSX/PPTX/images → Markdown |

### document_reader Tool

**Tool name**: `document_reader__convert_to_markdown`
**Input**: `uri: string` — must be a `file:`, `https:`, `http:`, or `data:` URI
**Output**: Markdown string of document content
**Skill**: Load `document-reader` skill for usage instructions

```
file:///absolute/path/to/file.pdf     # local file (MUST be absolute)
https://example.com/report.pdf        # remote file
```

## CONFIG PATTERNS

```typescript
// Remote MCP
export const mcp_name = {
  type: "remote" as const,
  url: "https://...",
  enabled: true,
  oauth: false as const,
  headers?: { ... },
}

// Local stdio MCP
export const mcp_name = {
  type: "local" as const,
  command: ["uvx", "--from", "package-name", "command"],
  enabled: true,
}
```

## HOW TO ADD

1. Create `src/mcps/my-mcp.ts` with config object
2. Add conditional check in `createBuiltinMcps()` in `index.ts`
3. Add name to `McpNameSchema` in `types.ts`

## NOTES

- **Disable**: Set `disabled_mcps: ["name"]` in config
- **document_reader**: Requires `uvx` (uv) installed on the system

## NOTES ON REMOVED WEBSEARCH MCP

The custom `websearch` MCP (Exa AI / Tavily) was removed; web search is now provided by the native `websearch` tool. Both remaining MCPs (context7, document_reader) are static configs assigned eagerly. See `docs/websearch-migration.md` for the provider mapping and migration notes.

