# PLUGIN KNOWLEDGE BASE

## OVERVIEW

V2 composition root: config loading, tool catalog, hook factories, and
setup-domain assembly. All plugin wiring lives here — leaf domains
(`hooks/`, `tools/`, `features/`, `skills/`) only export factories.

## STRUCTURE

```
plugin/
├── index.ts                      # Plugin interface assembly (8 handlers + compacting)
├── setup-domains.ts              # Init orchestration entry (auth → config → tools → hooks)
├── setup-domains/                # Split orchestration (assemble, hooks, managers, tools)
├── handlers/                     # Config loading, plan inheritance (15 files)
│   ├── config-handler.ts         # Main orchestrator — 6-phase loading
│   ├── agent-config-handler.ts   # Agent loading pipeline
│   ├── plan-model-inheritance.ts # Plan demotion logic
│   ├── oracle-agent-config-builder.ts # Oracle config builder
│   ├── plugin-components-loader.ts # Claude Code plugin discovery (10s timeout)
│   ├── provider-config-handler.ts # Provider config + model context limits cache
│   ├── tool-config-handler.ts    # Permission migration
│   ├── mcp-config-handler.ts     # Builtin + CC + plugin MCP merge
│   ├── command-config-handler.ts # Command/skill parallel discovery
│   ├── category-config-resolver.ts # Category lookup
│   ├── agent-priority-order.ts   # Agent ordering (morpheus, keymaker, oracle, niobe first)
│   ├── task-permissions.ts       # Task-store grant (mode-based, never a name list)
│   └── index.ts                  # Barrel exports
├── tool/                         # Tool catalog, definitions, chat/event handlers
│   ├── tool-definition.ts        # defineTool (re-exported from shared/tool/)
│   ├── tool-catalog.ts           # Tool registry assembly
│   ├── tool-policy.ts            # Conditional registration policy
│   ├── context.ts                # Tool execution context
│   ├── legacy-hooks.ts           # V1 hook adapters
│   ├── chat-message.ts           # chat.message handler
│   ├── chat-params.ts            # chat.params handler (Anthropic effort)
│   ├── event.ts / event-dispatch.ts # Session lifecycle events
│   ├── tool-execute-before.ts / tool-execute-after.ts
│   └── skill-context.ts / available-categories.ts / ...
├── hooks/                        # Hook factory composition (session, tool-guard, transform, ...)
├── message-hooks/                # Context injection, keyword detection, validators
└── hook-mutation-classification.md # Hook mutation policy notes
```

Tests mirror under `tests/plugin/` (`tests/plugin/handlers/` for config
loading, plus tool/catalog/event suites at the top level).

## CONFIG LOADING FLOW (6 phases, sequential)

1. `applyProviderConfig` → Cache model context limits, detect anthropic-beta headers
2. `loadPluginComponents` → Discover Claude Code plugins (10s timeout, error isolation)
3. `applyAgentConfig` → Load all agents, `morpheus`/`oracle`/`plan` demotion, `tdd_enforcer` stripped from `availableSkills` if disabled, `task_system` gating for `Mouse` vs legacy todos
4. `applyToolConfig` → Agent-specific tool permissions (github_search, task, teammate)
5. `applyMcpConfig` → Merge builtin + Claude Code + plugin MCPs
6. `applyCommandConfig` → Merge builtin + user + project + opencode commands/skills

## PLAN MODEL INHERITANCE

When `morpheus_agent.planner_enabled === true`:
1. Oracle config → extract model settings (model, variant, temperature, ...)
2. Apply user `agents.plan` overrides (plan override wins)
3. Set `mode: "subagent"` (plan becomes subagent, not primary)
4. Strip prompt/permission/description (only model settings inherited)

## AGENT LOADING ORDER

1. Builtin agents (morpheus, keymaker, oracle, ...)
2. Mouse (if morpheus enabled)
3. OpenCode-Builder (if `default_builder_enabled`)
4. Oracle (if `planner_enabled`)
5. User agents → Project agents → Plugin agents → Custom agents

**Reordered** by `reorderAgentsByPriority()`: morpheus, keymaker, oracle, niobe first.

## TOOL PERMISSIONS

`handlers/task-permissions.ts` owns the task-store grant: an agent receives `task_*` iff `MODE ∈ {primary, all}` and its work is multi-step. `isTaskStorePrimary(agent)` reads the agent's declared `mode` — never a name list. `taskStorePermissions` grants `task_*` only (tracking, no delegation); `fullTaskPermissions` adds `task` and `teammate`. `deriveTaskPermissions` picks the tracking-only set when the agent declares `permission.task === "deny"` for itself, so a read-only agent such as Sentinel needs no name list. `grantTaskPermissions` merges fill-only via `??=`, never clobbering a factory value or a user override. The criterion is one-directional — `Mouse` (`mode: "subagent"`) is the documented carve-out. Full policy: `docs/task-system.md` §3.5.

| Agent | Special Permissions |
|-------|---------------------|
| operator | github_search allowed |
| trinity | github_search allowed |
| niobe | task, task_*, teammate allowed |
| morpheus | task, task_*, teammate, question allowed |
| keymaker | task, task_*, teammate, question allowed |
| construct | Denies task, look_at |
| cipher | task_*, teammate allowed (derived, `mode: "all"`) |
| sentinel | task_* allowed, task denied (self-declared read-only) |

## INTEGRATION

Built in `setup-domains.ts`, exposed as the `config` hook. OpenCode calls it during session init.
