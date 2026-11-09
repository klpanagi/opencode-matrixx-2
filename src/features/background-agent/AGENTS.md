# BACKGROUND AGENT KNOWLEDGE BASE

## OVERVIEW

Background agent subsystem manages long-running AI subagent execution outside the foreground session lifecycle. Handles task creation, monitoring/polling loops, bounded wall-clock execution timeouts, completion notifications, disk-backed handle persistence, restart reconciliation across host restarts, session revive from persisted handles, and a shared finalizer with a generation gate. ~20 TS files, ~3100 LOC; orchestration is split across `manager/` (manager, lifecycle, reconcile, store, finalize, output-guard, types).

## STRUCTURE

```
background-agent/
├── manager/                # Orchestration split
│   ├── manager.ts          # Launch/revive/resume entry points
│   ├── lifecycle.ts        # Task lifecycle transitions
│   ├── finalize.ts         # Single terminal finalizer + generation gate
│   ├── output-guard.ts     # Assistant output validation (confirms terminal output)
│   ├── reconcile.ts        # Restart reconciliation — classifies persisted running/pending handles
│   ├── store.ts            # In-memory handle store
│   └── types.ts            # Manager-internal types
├── types.ts                # BackgroundTask, LaunchInput, terminal reason types
├── constants.ts            # Defaults: timeouts, polling intervals, wallclock
├── handle-index.ts         # File-backed handle index (atomic tmp+renameSync writes)
├── revive.ts               # Session revive — revivable-set classifier + handle rehydration
├── error-helpers.ts        # Error message extraction helpers
├── notification-builder.ts # Completion notification formatting
├── task-history.ts         # Per-session task history tracking
├── task-map.ts             # Per-task Map helpers
├── message-dir.ts          # Per-task message directory management
└── wallclock.ts            # Wall-clock timeout enforcement
```

## KEY PATTERNS

**Supervisor Lifecycle:** On launch, `LaunchInput` → spawn child session via `session.create` → poll loop every `POLLING_INTERVAL_MS` checking for assistant output → on terminal status, hand off to `finalizeTask()` (handle-index record, history, completion notification), sweep stale handles if TTL exceeded. The manager runs exactly one polling loop per active task using a Map keyed by `taskId`.

**Finalizer + generation gate:** Every terminal transition goes through `manager/finalize.ts`. It guards against stale writers via `task.generation` vs the persisted generation, so a late result from an older handle cannot overwrite a newer one.

**Output guard:** `manager/output-guard.ts` inspects session messages for substantive assistant/tool content. It is wired into both completed transitions to decide whether a task genuinely produced output; it is a validation mechanism only.

**Wallclock Enforcement:** `wallClockTimeoutMs` defaults to `0` (OFF). Any non-zero value sets a hard upper bound (union type: exactly `0` or ≥60000). When exceeded, the task is terminated with `terminalReason: "wall-clock-timeout"`. The abort is immediate; the deprecated `wallClockAbortGraceMs` key is accepted but ignored.

**Concurrency Model:** (removed PR-2: queue admission/semaphores deleted, keys gone; `queue-saturated` retained as a compat-only handle value with no producer in current code).

**Handle Persistence:** All tasks written atomically to `<project>/.matrixx/bg-handles/<taskId>.json` via temp+renameSync. Handles tracked in-memory Set bounded by `TASK_TTL_MS` (30 min). `sweepStaleHandles()` removes expired entries to prevent unbounded growth. On startup, `restoreHandles()` reconciles each persisted handle against the live host.

## TERMINAL REASONS

`BackgroundTerminalReason` enum: `queue-saturated | no-output | uncertain | aborted | nested-depth-exceeded | wall-clock-timeout`. `queue-saturated` and the older `stale`/`expired` values are parse-only compat values; current code never produces them. Persisted on `BgHandleSchema.terminalReason` for post-mortem analysis.
