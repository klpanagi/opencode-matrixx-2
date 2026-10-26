> Archived / historical — preserved as-is, do not rely on counts/versions; superseded by v2-native docs (2.0.0, OpenCode-v2-only).

# Websearch Migration: Custom MCP to Native Tool

The custom `websearch` MCP (`src/mcps/websearch.ts`, Exa AI / Tavily) was removed.
Web search is now provided by the native `websearch` tool. This note covers
everything needed to migrate existing configs.

## Provider Mapping

| Before (custom MCP `websearch.provider`) | After (native `websearch` tool) |
|------------------------------------------|---------------------------------|
| `exa` (default, no API key needed)       | `exa` via the native tool       |
| `tavily` (requires `TAVILY_API_KEY`)     | `tavily` via the native tool   |

Delete the `websearch` block from your config — there is no replacement key.
For the full list of providers supported by the native tool, see the official
OpenCode documentation.

## Environment Keys

| Key | Before | After |
|-----|--------|-------|
| `EXA_API_KEY` (optional) | Used by the custom MCP when set | Passed through to the native tool when set; keyless search works without it |
| `TAVILY_API_KEY` (required for tavily) | Required when `provider: "tavily"` | Still required when using the `tavily` provider natively |

No key renames. Leave existing exports in place.

## Disabling Web Search

| Before | After |
|--------|-------|
| `"disabled_mcps": ["websearch"]` | `"tools": { "websearch": false }` (per agent/category) |

A legacy `"websearch"` entry inside `disabled_mcps` is harmless and ignored.

## Warn-and-Ignore Behavior

A leftover top-level `websearch` object in `matrixx.json` / `matrixx.jsonc`
does NOT fail validation. It is stripped before Zod parsing with a one-time
`console.warn` per session (see `stripLegacyWebsearchKey()` in
`src/plugin-config.ts`). Remove the block at your convenience.

```jsonc
{
  // Legacy — stripped with a warning, safe to delete:
  // "websearch": { "provider": "tavily" },

  // Current — disable natively per agent/category:
  // "tools": { "websearch": false }
}
```
