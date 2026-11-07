# BACKGROUND AGENT KNOWLEDGE BASE

## OVERVIEW

Background agent subsystem manages long-running AI subagent execution outside the foreground session lifecycle. Handles task creation, queue admission, concurrency enforcement via model-level semaphores, monitoring/polling loops, stale timeout termination, completion notifications, disk-backed handle persistence, restart reconciliation across host restarts, bounded wall-clock execution timeouts, session revive from persisted handles, and circuit breaker protection against tool-use loops. ~20 TS files, ~3100 LOC; orchestration is split across `manager/` (manager, lifecycle, reconcile, store, types).

## STRUCTURE

```
background-agent/
├── manager/                # Orchestration split
│   ├── manager.ts          # Launch/revive/resume entry points
│   ├── lifecycle.ts        # Task lifecycle transitions
│   ├── reconcile.ts        # Restart reconciliation — classifies persisted running/pending handles
│   ├── store.ts            # In-memory handle store
│   └── types.ts            # Manager-internal types
├── manager.bench.ts        # Bench harness
├── types.ts                # BackgroundTask, LaunchInput, terminal reason types
├── constants.ts            # Defaults: concurrency, timeouts, polling intervals, wallclock
├── loop-detector.ts        # Circuit breaker — repetitive tool-use detection (sliding window)
├── handle-index.ts         # File-backed handle index (atomic tmp+renameSync writes)
├── revive.ts               # Session revive — revivable-set classifier + handle rehydration
├── error-helpers.ts        # Error message extraction helpers
├── notification-builder.ts # Completion notification formatting
├── session-output.ts       # Assistant output validation (prevents zombie background tasks)
├── task-history.ts         # Per-session task history tracking
├── message-dir.ts          # Per-task message directory management
├── wallclock.ts            # Wall-clock timeout enforcement
└── state.ts                # Task state serialization helpers
```

## KEY PATTERNS

**Supervisor Lifecycle:** (removed PR-2: queue admission/semaphores deleted; `queue-saturated`/`nested-depth-exceeded` retained as compat-only handle values) On launch, `LaunchInput` → spawn child session via `session.create` → poll loop every `POLLING_INTERVAL_MS` checking for assistant output / stale inactivity → on terminal status, record to handle-index, send completion notification, sweep stale handles if TTL exceeded. The manager runs exactly one polling loop per active task using a Map keyed by `taskId`.

**Wallclock Enforcement:** `wallClockTimeoutMs` defaults to `0` (OFF). Any non-zero value sets a hard upper bound (union type: exactly `0` or ≥60000). When exceeded, the task is terminated with `terminalReason: "wallclock-timeout"`. `wallClockAbortGraceMs` (default 5000ms) provides a grace period between timeout fire and actual abort signal, allowing graceful flush. Zero means no grace — immediate kill. This is applied uniformly to all agents regardless of category.

**Concurrency Model:** (removed PR-2: queue admission/semaphores deleted, keys gone; `queue-saturated` retained as compat-only handle value).

**Handle Persistence:** All tasks written atomically to `<project>/.matrixx/bg-handles/<taskId>.json` via temp+renameSync. Handles tracked in-memory Set bounded by `TASK_TTL_MS` (30 min). `sweepStaleHandles()` removes expired entries to prevent unbounded growth. On startup, `restoreHandles()` reconciles each persisted handle against the live host.

**Circuit Breaker:** Sliding window (configurable `maxToolCalls` default 75) detects repetitive tool usage via `detectRepetitiveToolUse()`. Consecutive failures above `consecutiveThreshold` (default 3) trip the breaker, preventing runaway tool calls. Configurable per-feature via `{ enabled, maxToolCalls, consecutiveThreshold }`.

## TERMINAL REASONS

`BackgroundTerminalReason` enum: `queue-saturated | no-output | uncertain | aborted | stale | nested-depth-exceeded | wallclock-timeout`. Persisted on `BgHandleSchema.terminalReason` for post-mortem analysis.
