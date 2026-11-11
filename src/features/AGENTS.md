# FEATURES KNOWLEDGE BASE

## OVERVIEW

Feature modules (builtin-commands, task-storage, bdd, assembly-state, handoff, context-injection, session-state...) — task-storage is now execution substrate (file-backed `.matrixx/tasks/`, replaces ephemeral todos).

## STRUCTURE
```
features/
├── builtin-commands/           # 23 commands, 21 templates
├── task-storage/               # Task system: schema + file-backed storage (project-scoped `getTaskDir()`, atomic `tmp+renameSync`) — 3 files + `task-toast-manager/` — see task-storage/AGENTS.md
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
├── session-state/              # Subagent session state tracking (2 files)
├── task-session-scope/         # Task session scoping + ancestry
├── task-toast-manager/         # Task progress notifications (3 files)
├── tool-metadata-store/        # Tool execution metadata caching (3 files)
└── redpill-state/            # Redpill loop state
```

Tmux integration lives in `src/shared/tmux/` (no feature dir).

## KEY PATTERNS

**Background Agent Lifecycle:**
Task creation → Queue → Admission check → Concurrency check → Execute → Monitor/Poll → Notification → Cleanup

**Terminal statuses** (`BackgroundTaskStatus`): `pending | running | completed | error | cancelled | interrupt | stopped | statusUncertain`. New Tier-1 additions:
- `stopped` — the session ended without terminal output (or admission was refused). Does NOT imply failure or success.
- `statusUncertain` — liveness could not be determined (e.g. host lookup failed after restart). Does NOT imply failure or completion.
- `interrupt` is retained for genuine mid-flight aborts (promptAsync rejection / abort).

**`BackgroundTerminalReason`** (optional, persisted on handle): `queue-saturated | no-output | uncertain | aborted | stale | nested-depth-exceeded`. Written to `BgHandleSchema.terminalReason` in `<project>/.matrixx/bg-handles/<taskId>.json`. Old handle files without these fields still load.

**Restart reconciliation** (`manager/reconcile.ts`): On plugin start, `restoreHandles()` probes the live host for each persisted `running|pending` handle and classifies it as `completed | error | running | stopped | statusUncertain` instead of blindly flattening to `interrupt`. A still-running child is re-registered and polling restarts; concurrency is deliberately NOT re-acquired. Lookup failure degrades to `statusUncertain` (never assumes completion).

**Bounded admission** (removed PR-2: queue admission/semaphores deleted, keys gone; `queue-saturated` retained as compat-only handle value).

**Nested-admission exemption** (removed PR-2: queue admission/semaphores deleted, keys gone; `nested-depth-exceeded` retained as compat-only handle value).

**Session revive** (`revive.ts`, `background_revive` tool): A terminal task whose handle is still on disk can be resumed with a NEW instruction. Retention IS the existing handle files — there is no separate store — bounded by `TASK_TTL_MS` (30 min). Revivable: `cancelled | stopped | interrupt | error | completed` (each requires a `sessionID`); `statusUncertain` requires `force: true`; `pending | running` must use `background_output` instead; a handle that never produced a session (e.g. `queue-saturated`) is unrevivable. `manager.revive()` falls back to disk on an in-memory map miss, then re-admits through bounded/nested admission — and a nested revive bypasses the semaphore entirely so it can never await it unboundedly. `manager.resume()` remains the in-memory-only path.

**Background task history + notifications** (`task-history.ts`, `notification-builder.ts`): helper modules, NOT hooks. Both are fed by the shared `finalizeTask` finalizer; the removed `wakeScheduler`/`jobBoard` config keys are deprecated, accepted for config compatibility, and ignored.
- **Default conservation** (U9): `background` default stays `false`. `true` is async fan-out (the parent session auto-receives a completion message with the child output; or retrieve via `session_read`); `false` is sync inline. Never call `subagent()` sequentially for independent work.

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
