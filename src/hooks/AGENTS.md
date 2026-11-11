# HOOKS KNOWLEDGE BASE

## OVERVIEW

71 accepted hook names (64 enum + 6 retained literals + 1 alias; 59 dirs + 9 loose `.ts` on disk) intercepting/modifying agent behavior across 7 event types. Five factories in `src/plugin/hooks/`: session, tool-guard, transform, continuation, skill.

## STRUCTURE
```
hooks/
├── agent-usage-reminder/         # Specialized agent hints
├── context-window-limit-recovery/ # Provider-agnostic recovery
├── anthropic-effort/             # Effort=max for Opus max variant
├── niobe/                        # Main orchestration hook
├── auto-slash-command/           # Detects /command patterns
├── auto-update-checker/          # Plugin update check
├── background-notification/      # OS notifications
├── category-skill-reminder/      # Category+skill delegation reminders
├── comment-checker/              # Prevents AI slop comments
├── compaction-context-injector/  # Injects context on compaction
├── context-mode-enforcer/        # Routes raw file/network work to the context-mode sandbox; companion system-transform lives in `src/features/context-injection/routing/`
├── context-window-monitor.ts     # Reminds of headroom at 70%
├── design-intent-preserver/      # Preserves design intent across edits
├── directory-agents-injector/    # Auto-injects AGENTS.md
├── edit-error-recovery/          # Recovers from edit failures
├── empty-task-response-detector.ts # Detects empty responses
├── interactive-bash-session/     # Tmux session management
├── keyword-detector/             # redpill/search/analyze modes
├── non-interactive-env/          # Non-TTY handling
├── preemptive-compaction.ts      # Auto-compact at 78% usage
├── plan-persister/              # Persists plan state to disk on idle + compact
├── oracle-md-only/           # Planner read-only mode
├── quality-gate/                 # Post-task quality verification
├── matrix-loop/                   # Self-referential dev loop
├── rules-injector/               # Conditional .morpheus/rules injection
├── session-notification.ts       # OS idle notifications
├── session-recovery/             # Auto-recovers from crashes
├── mouse-notepad/      # Junior notepad directive
├── start-work/                   # Morpheus work session starter
├── stop-continuation-guard/      # Guards stop continuation
├── task-resume-info/             # Resume info for cancelled tasks
├── think-mode/                   # Dynamic thinking budget
├── thinking-block-validator/     # Validates thinking blocks
├── tool-output-truncator.ts      # Prevents context bloat
├── task-edit-guard/               # Blocks raw bash edits to .matrixx/plans and .matrixx/tasks — enforces plan_*/task_* tools; BLOCKs generic Write/Edit to plans (tool.execute.before)
└── write-existing-file-guard/    # Guards against file overwrite
```

`unstable-agent-babysitter` is a deprecated alias only — its implementation was removed, the name still parses so old configs keep loading, and it resolves to a no-op.

## EVENT TYPES

| Event | Hook Method | Can Block | Count |
|-------|-------------|-----------|-------|
| UserPromptSubmit | `chat.message` | Yes | 4 |
| ChatParams | `chat.params` | No | 2 |
| PreToolUse | `tool.execute.before` | Yes | 14 |
| PostToolUse | `tool.execute.after` | No | 18 |
| SessionEvent | `event` | No | 17 |
| MessagesTransform | `experimental.chat.messages.transform` | No | 1 |
| Compaction | `onSummarize` | No | 1 |

## BLOCKING HOOKS (7)

| Hook | Event | Blocks When |
|------|-------|-------------|
| auto-slash-command | chat.message | Command execution fails |
| context-mode-enforcer | tool.execute.before | Conditional, only under `enforce`: `grep`/`glob` and `webfetch` blocked when `hasWorkingSubstitute()` is true (use `ctx_search` / `ctx_index then ctx_search`); fetch-shaped `bash` blocked only when `bash` is also in `blockedTools`; `read` is warn-only and never throws. Non-enforce mode only attaches `output.message`, and a per-session throttle (`guidance-throttle.ts`) shows each guidance once per session |
| keyword-detector | chat.message | Keyword injection fails |
| non-interactive-env | tool.execute.before | Interactive command in non-TTY |
| oracle-md-only | tool.execute.before | Write outside .morpheus/*.md |
| task-edit-guard | tool.execute.before | Raw bash mutation of `.matrixx/plans/*.md` or `.matrixx/tasks/T-*.json` — use `plan_*` or `task_*` tools; generic Write/Edit to plans BLOCKED with plan_* hint |
| write-existing-file-guard | tool.execute.before | Write to existing file |

## EXECUTION ORDER

**UserPromptSubmit**: keywordDetector → autoSlashCommand → startWork
**PreToolUse**: subagentBlock → nonInteractiveEnv → commentChecker → directoryAgentsInjector → rulesInjector → oracleMdOnly → contextModeEnforcer (fail-fast wave, after oracleMdOnly) → mouseNotepad → writeExistingFileGuard → niobeHook
**PostToolUse**: toolOutputTruncator → contextWindowMonitor → commentChecker → directoryAgentsInjector → rulesInjector → emptyTaskResponseDetector → agentUsageReminder → interactiveBashSession → editErrorRecovery → delegateTaskRetry → niobeHook → taskResumeInfo

## HOW TO ADD

1. Create `src/hooks/name/` with `index.ts` exporting `createMyHook(ctx)`
2. Add hook name to `HookNameSchema` in `src/config/schema/hooks.ts`
3. Register in appropriate `src/plugin/hooks/create-*-hooks.ts`

## ANTI-PATTERNS

- **Heavy PreToolUse**: Runs before EVERY tool — keep light
- **Blocking non-critical**: Use PostToolUse warnings instead
- **Redundant injection**: Track injected files to avoid context bloat
- **Direct state mutation**: Use `output.output +=` instead of replacing
