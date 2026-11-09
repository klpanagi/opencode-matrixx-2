# SRC KNOWLEDGE BASE

## OVERVIEW

Main plugin entry point and orchestration layer. Plugin initialization, hook registration, tool composition, and lifecycle management.

## STRUCTURE

```
src/
├── index.ts                          # V2-native { id, setup } entry → setup-domains
├── tool-entry.ts                     # Side-effect-free bench/sandbox entry (not the plugin entry)
├── plugin-config.ts                  # Config loading orchestration (user + project merge)
├── plugin-state.ts                   # Model cache state (context limits)
├── agents/                           # 13 AI agents (50 files) — see agents/AGENTS.md
├── cli/                              # CLI installer, doctor (27 files, no per-area AGENTS.md)
├── config/                           # Zod schema — see config/AGENTS.md
├── features/                         # Background agents, commands (21 dirs) — see features/AGENTS.md
├── hooks/                            # Leaf hook domains (HookNameSchema 64 enum + 6 literals + 1 alias) — see hooks/AGENTS.md
├── mcps/                             # Built-in MCPs (2: context7, document-reader) — see mcps/AGENTS.md
├── plugin/                           # V2 composition root (setup-domains, handlers/, tool/) — see plugin/AGENTS.md
├── shared/                           # Cross-cutting utilities (~118 files, 12 scopes + 5 legacy) — see shared/AGENTS.md
├── skills/                           # 70 built-in skills (builtin/ + loader/) — see skills/AGENTS.md
└── tools/                            # 30 tool dirs (LSP, AST-grep, delegate-task, bdd-*, handoff, etc.; conditional via plugin/tool/tool-policy.ts) — see tools/AGENTS.md
```

## PLUGIN INITIALIZATION (`setup-domains.ts`)

1. `createNativePluginContext(ctx)` — in-process V2 context (no HTTP; the old server-auth injection has no native twin)
2. `startTmuxCheck()` — Tmux availability
3. `loadPluginConfig(...)` — User + project config merge → Zod validation (+ DCP `default_profile` switch)
4. `createFirstMessageVariantGate()` — First message variant override gate
5. `createDomainManagers(...)` — Tmux/background/session managers
6. `setupToolsDomain(...)` → skill context + categories + tool catalog
7. Hook tiers (session, tool-guard, transform, continuation, skill) + `setupChatHooks` + `setupToolHooks` + `setupCompactionHooks`
8. Assemble `Hooks` + `registerDomains(...)` onto the V2 context (+ dispose cleanup)

## HOOK REGISTRATION (5 factories in `src/plugin/hooks/`)

- **Session** (`create-session-hooks.ts`): context-window-monitor, session-recovery, think-mode, matrix-loop, anthropic-effort, ...
- **Tool guard** (`create-tool-guard-hooks.ts`): comment-checker, tool-output-truncator, rules-injector, write-existing-file-guard, ...
- **Transform** (`create-transform-hooks.ts`): keyword-detector, context-injector, thinking-block-validator, ...
- **Continuation** (`create-continuation-hooks.ts`): stop-continuation-guard, compaction-context-injector, nudge-loop-breaker, background-notification (unified parent notification via `handleEvent`), niobe, plan-persister, ...
- **Skill** (`create-skill-hooks.ts`): category-skill-reminder, auto-slash-command

Task-continuation enforcement now lives in `features/task-session-scope/` (`staleness.ts`, `todo.ts`), kept from the removed enforcer.

## PLUGIN INTERFACE (assembled `Hooks`)

| Handler | Source | Purpose |
|---------|--------|---------|
| `tool` | filteredTools | All registered tools |
| `chat.params` | createChatParamsHandler | Anthropic effort level |
| `chat.message` | createChatMessageHandler | First message variant, session setup |
| `session.hook("context" \| "compaction" \| "generate")` | registerMessageHooks | Context injection, keyword detection |
| `config` | configHandler | Agent/MCP/command registration |
| `event` | createEventHandler | Session lifecycle |
| `tool.execute.before` | createToolExecuteBeforeHandler | Pre-tool hooks |
| `tool.execute.after` | createToolExecuteAfterHandler | Post-tool hooks |

## SAFE HOOK CREATION PATTERN

```typescript
const hook = isHookEnabled("hook-name")
  ? safeCreateHook("hook-name", () => createHookFactory(ctx), { enabled: safeHookEnabled })
  : null;
```

All hooks use this pattern for graceful degradation on failure.

## TASK SYSTEM CONVENTIONS

Plan and task progress have dedicated tools — raw bash file hacks are blocked.

- Plan progress (`.matrixx/plans/*.md` `- [ ]` -> `- [x]`) -> `plan_read` -> `plan_update` with `LINE#ID` (hashline). Never `Read`/`Edit`/`sed`/`python3 -c` via `bash`. `plan-persister` counts `- [x]` for `todoCompleted`, this is not `T-*.json` runtime tasks.
- Task files (`.matrixx/tasks/T-*.json`) -> `task_create`/`task_update`/`task_get`/`task_list`/`task_cleanup` via `MatrixxContext` directory threading. Never `bash` `echo`/`cat >`/`rm`/`sed`/`python`.
- Enforcement: `task-edit-guard` hook (`tool.execute.before` on `bash` with `BLOCKED_PATTERNS`) blocks raw bash mutations to `.matrixx/plans/*.md` and `.matrixx/tasks/T-*.json`. Use `plan_*` tools for plans and `task_*` tools for tasks.
- `.matrixx/` is gitignored — project tasks and plans stay local per clone (per-project isolation via `getTaskDir(config, directory)`).

## ANTI-PATTERNS

| Category | Forbidden |
|----------|-----------|
| Bash plan/task hacks | `sed`/`python`/`echo >` on `.matrixx/plans` or `.matrixx/tasks` — use `plan_*` or `task_*` tools |
