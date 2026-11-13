# FEATURES KNOWLEDGE BASE

## OVERVIEW

Feature modules (builtin-commands, task-storage, bdd, assembly-state, handoff, context-injection, session-state...) — task-storage is now execution substrate (file-backed `.matrixx/tasks/`, replaces ephemeral todos).

## STRUCTURE
```
features/
├── agent-effort/               # Per-agent effort overrides
├── builtin-commands/           # 23 commands, 21 templates
├── task-storage/               # Task system: schema + file-backed storage (project-scoped `getTaskDir()`, atomic `tmp+renameSync`) — 5 files — see task-storage/AGENTS.md
├── context-injection/          # System message injection (hook-bridge/, injector/, routing/)
├── assembly-state/             # Assembly voting state (enable/disable, reset)
├── bdd/                        # BDD contract schemas + pipeline support
├── command-loader/             # User/project command discovery + loading
├── completion-review/          # Post-completion review + evidence handling
├── handoff/                    # Multi-action handoff: create, read, list, archive
├── knowledge-hub/              # Knowledge-hub loading + path expansion
├── mission-state/              # Persistent state for multi-step ops (10 files)
├── plan-contract/              # Plan contract: canonical sections, task grammar
├── preset-state/               # Model preset state
├── rtk-routing/                # RTK shell-discipline routing block
├── session-memory/             # Session memory + compaction snippets
├── session-state/              # Subagent session state tracking (3 files)
├── task-session-scope/         # Task session scoping + ancestry
├── tool-metadata-store/        # Tool execution metadata caching (3 files)
└── redpill-state/            # Redpill loop state
```

Tmux integration lives in `src/shared/tmux/` (no feature dir).

## KEY PATTERNS

**Native Subagent Delegation:**
Delegation goes through the native `subagent` tool (an injected completion message arrives in the parent session; retrieve the transcript with `session_read`). There is no background-agent manager, handle store, admission queue, polling loop, or revive path — those were removed with the legacy `delegate_task` system. The legacy names (`task`, `background_output`, `background_cancel`, `background_revive`, `background_wait_all`) resolve to guard stubs in `src/tools/removed-tools/`.

**Fan-out:** There is no `background` argument (stripped by `applySubagentPolicy`); every child is async and the parent absorbs its completion message. Fire independent children in one turn and retrieve transcripts with `session_read` when needed; never call `subagent()` sequentially for independent work.

**Skill Management:** All skills are loaded from `src/skills/` via `createBuiltinSkills()`. No external skill directory loading. Skills are configured via `disabled_skills` in `matrixx.jsonc`.

**SKILL.md Format:**
```yaml
---
name: my-skill
description: "..."
model: "claude-opus-4-6"    # optional
agent: "morpheus"           # optional
mcp:                        # optional embedded MCPs
  server-name:
    type: http
    url: https://...
---
# Skill instruction content
```

## HOW TO ADD

1. Create directory under `src/features/`
2. Add `index.ts`, `types.ts`, `constants.ts` as needed
3. Export from `index.ts` following barrel pattern
4. Register in main plugin if plugin-level feature

## CHILD DOCUMENTATION

- See `task-storage/AGENTS.md` for task schema and storage details
