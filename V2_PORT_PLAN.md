# Matrixx → OpenCode V2 Plugin API Port Plan

Status: **Stage 1 in progress**. Owner: matrixx maintainers.
Created: 2026-10-25.

## 1. Problem

Matrixx is written against the **V1** OpenCode plugin API
(`@opencode-ai/plugin@1.3.15`: `export default async (PluginInput) => Hooks`).
OpenCode **2.x** replaced the plugin API:

- A plugin must `export default` an object `{ id: string, setup(ctx): Cleanup | void }`
  (or `{ id, effect }` for Effect plugins), validated by
  `packages/core/src/plugin/module.ts` (`PluginModule.Module` schema).
- There is **no V1 compatibility path**. A V1 default export produces
  `PluginModule.LoadError: Plugin must export a default definition with an id and an effect or setup function.`
- Consequently matrixx (and any V1-only plugin) cannot load in OpenCode 2.x.
  This is why the user's session shows matrixx absent from `opencode plugin list`.

The repo's "v2" in `2.6.18` refers to the matrixx release line seeded from v1 — it is
**not** an OpenCode V2 plugin build. `MIGRATION_PLAN.md` is unrelated (it plans removing
local directory loaders in favour of the `config` hook).

## 2. Entrypoint contract (verified)

`packages/core/src/plugin/module.ts` lines 103-124:

| Config `plugins` entry | Resolution |
|---|---|
| absolute path to a **file** | that file URL is the server entrypoint |
| absolute path to a **directory** | `<dir>/server` then `<dir>/index` (via `Host.resolve`) |
| npm package | `<name>/server` then package main |

Then the module is decoded against `{ default: {id, effect} | {id, setup} }`.
Local sources are read through `sources.read()` (TS-capable).

**Implications**

- Today `plugins: ["/home/klpanagi/Development/opencode-matrixx-2"]` resolves
  `<repo>/server` → `<repo>/index` — neither exists → no load.
- The e2e harness uses `{ "package": "/work/dist" }` → `<dist>/server` → `<dist>/index`
  (`dist/index.js`). Building the V2 entry to `dist/index.js` satisfies it unchanged.
- We also expose a `./server` package export so package and directory forms both work.

## 3. Target architecture

This repository is the V2 line only. There is exactly one plugin implementation
and one entrypoint; no dual V1/V2 build is produced or supported.

`src/index.ts` is the OpenCode plugin entrypoint and default-exports
`{ id: "matrixx", setup }`. The core modules were originally written against the
plugin context and hook shapes of OpenCode 1, so the entrypoint composes three
responsibilities:

1. build the context the core expects from the OpenCode plugin context,
2. run the core (`src/plugin/plugin-factory.ts`),
3. register the hooks it produces onto the OpenCode domains.

```
src/index.ts                       # { id: "matrixx", setup }  → dist/index.js
src/plugin/
├── plugin-factory.ts              # the plugin body (config load, managers, tools, hooks)
├── opencode-types.ts              # structural types for the OpenCode plugin context
├── opencode-context.ts            # plugin context → the context the core expects
├── opencode-client.ts             # server access shim used by the core
├── opencode-hooks.ts              # hook registration onto the OpenCode domains
├── opencode-events.ts             # event payload normalization
└── opencode-tools.ts              # tool definition translation
```

`src/plugin/opencode-*.ts` is a **transitional seam, not a compatibility layer**:
each migration stage in §6 deletes part of it as the corresponding core module is
rewritten to use the OpenCode API directly. Nothing outside the entrypoint
depends on the seam.

No new runtime dependency: the plugin default export is a plain object literal, so
`@opencode/plugin` is not imported at runtime.

## 4. Hook mapping (verified against `packages/plugin/src/promise/*`)

| V1 hook | V2 registration | Notes |
|---|---|---|
| `tool` (map) | `ctx.tool.transform(e => e.add(...))` | zod args → `input` (Standard Schema) |
| `tool.definition` | `ctx.tool.transform(e => e.update(id, t => …))` | rewrite description/parameters |
| `tool.execute.before` | `ctx.tool.hook("execute.before", e => …)` | mutate `e.input`; throw to block |
| `tool.execute.after` | `ctx.tool.hook("execute.after", e => …)` | `e.result` (completed) / `e.error` |
| `event` | `ctx.event.subscribe({signal})` loop | normalize event → `{type, properties}` |
| `config` | `ctx.{agent,command,mcp,skill,model,provider,reference}.transform(e => …)` | per-domain editors |
| `chat.message` | `ctx.session.hook("prompt", e => …)` | mutable `prompt.text/files/…` |
| `chat.params` | `ctx.session.hook("context", e => e.options …)` | generation options |
| `chat.headers` | `ctx.session.hook("model.request", e => e.headers …)` | |
| `experimental.chat.system.transform` | `ctx.session.hook("context", e => e.system.push({type:"text",text}))` | push, not replace |
| `experimental.chat.messages.transform` | `ctx.session.hook("context", e => e.messages …)` | shape translation needed |
| `experimental.session.compacting` | `ctx.session.hook("compaction", e => …)` | set `e.result` to skip model call |
| `shell.env` | `ctx.shell.hook("create.before", …)` | not currently used by matrixx |

## 5. Client mapping (V1 `ctx.client` → V2 context domains)

`@opencode-ai/sdk` client → V2 plugin context (no HTTP round-trip needed):

| V1 | V2 |
|---|---|
| `session.messages({path:{id}})` | `session.context({sessionID})` |
| `session.list/get/create/update/delete` | `session.list/get/create/update/remove` |
| `session.prompt` / `promptAsync` | `session.prompt` |
| `session.abort` | `session.interrupt` |
| `session.summarize` | `session.compact` |
| `model.list` | `model.list` |
| `provider.list` | `provider.list` |
| `app.agents` | `agent.list` |
| `command.list` | `command.list` |
| `permission.*` | `permission.*` |
| `tui.showToast` | **no twin** (TUI toast is a server event) |
| `session.status` | **no twin** in plugin context |
| `config.get` | **no twin** in plugin context |
| `client.write`, `client.influxdb`, `gen.ts` | **no twin** (legacy/custom SDK groups) |

Unmapped methods are surfaced loudly: the shim logs
`[matrixx-v2] unmapped client method: <path>` once per path and returns
`{ data: undefined }` so read paths degrade instead of throwing.

## 6. Stages

- **Stage 0 — triage (done).** Keep `context-mode` as an MCP server (`mcp.servers`), remove
  V1-only plugins (`context-mode@latest` plugin entry, `opencode-plugin-auto-update@latest`,
  `opencode-mem@latest` disabled).
- **Stage 1 — entrypoint + seam (done).** `src/index.ts` default-exports
  `{ id: "matrixx", setup }`; `src/plugin/opencode-*.ts` bridges context, tools, hooks,
  events and config into the core. Exit criteria: `bun run typecheck` clean;
  `bun run build` produces a `dist/index.js` whose default export has `id` + `setup`;
  `opencode plugin list` shows `matrixx`; `bash script/e2e-runtime.sh --tier=pr` green.
- **Stage 2 — server access.** Replace `src/plugin/opencode-client.ts` by moving the core onto
  the plugin context directly, deleting the shim. Track the session status that V1 read via
  `session.status` from the event stream, and route toast notifications to the TUI.
- **Stage 3 — config registration.** Replace the `config`-draft fan-out in
  `opencode-hooks.ts` with explicit `agent`/`command`/`mcp`/`skill` transforms owned by the
  modules that build those definitions.
- **Stage 4 — request transforms.** Rewrite the system/message transforms and compaction
  injection against `session.hook("context")` / `session.hook("compaction")` so
  `opencode-hooks.ts` no longer translates payload shapes.
- **Stage 5 — packaging + CI.** Drop the remaining seam modules, update the schema/docs, and
  wire the e2e nightly tier into the publish workflow.

## 7. Verification

- `bun run typecheck`, `bun run lint`, `bun run build`.
- `bun -e "await import('./dist/index.js')"` smoke (must expose default `{id, setup}`).
- `bash script/e2e-runtime.sh --tier=pr` — containerized real OpenCode V2 load test
  (docker/podman both available locally).
- Manual: `opencode plugin list` in a session rooted at this repo.
