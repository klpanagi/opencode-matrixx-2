import { z } from "zod"

const HookNameEnum = z.enum([
  "context-window-monitor",
  "session-recovery",
  "session-notification",
  "comment-checker",
  "tool-output-truncator",
  "directory-agents-injector",
  "empty-task-response-detector",
  "think-mode",
  "context-window-limit-recovery",
  "rules-injector",
  "auto-update-checker",
  "startup-toast",
  "keyword-detector",
  "domain-keyword-detector",
  "agent-usage-reminder",
  "non-interactive-env",
  "interactive-bash-session",

  "thinking-block-validator",
  "matrix-loop",
  "category-skill-reminder",

  "compaction-context-injector",
  "auto-slash-command",
  "edit-error-recovery",
  "oracle-md-only",
  "plan-persister",
	"mouse-notepad",
  "start-work",
  "niobe",
  "task-resume-info",
  "stop-continuation-guard",
  "write-existing-file-guard",
  "silent-failure-guard",
  "anthropic-effort",
  "hashline-read-enhancer",
  "secret-leak-guard",
  "input-secret-guard",
  "env-context-injector",
  "env-file-write-guard",
  "json-error-recovery",
  "bash-file-read-guard",
  "runtime-fallback",
  "read-image-resizer",
  "webfetch-redirect-guard",
  "tool-pair-validator",
  "quality-gate",
  "design-intent-preserver",
  "rtk-bash-rewriter",
  "context-mode-enforcer",
  "task-edit-guard",
  "document-reader-guard",
  "docs-lookup-guard",
  "knowledge-hub-guard",
  "knowledge-hub-injector",
  "knowledge-hub-search-nudge",
  "dcp-nudge-sanitizer",
  "compress-watchdog",
  "nudge-loop-breaker",
  "task-notepad-writer",
  "session-memory",
])

// Deprecated alias — remove in v2.7 (BREAKING: rename anthropic- → generic)
//
// The literals below belong to removed subsystems. Their hooks no
// longer exist, but the NAMES stay parseable so a config written before the
// removal keeps loading without an `invalid_enum` error. They are deliberately
// NOT mapped onto a live hook (no rename target) and NOT `.transform()`ed — see
// `HOOK_NAME_MAP` in `src/shared/migration/hook-names.ts`, which strips them
// from the effective `disabled_hooks` with one warn.
export const HookNameSchema = z.union([
  HookNameEnum,
  z.literal("anthropic-context-window-limit-recovery").transform(() => 'context-window-limit-recovery' as const),
  /** @deprecated no-op since v2.7 — hook removed, name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("todo-continuation-enforcer"),
  /** @deprecated no-op since v2.7 — hook removed, name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("compaction-todo-preserver"),
  /** @deprecated no-op since v2.7 — hook removed, name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("tasks-todowrite-disabler"),
  /** @deprecated no-op since v2.7 — hook removed, name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("task-notepad"),
  /** @deprecated no-op — hook removed, name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("task-continuation-enforcer"),
  /** @deprecated no-op (D6) — preemptive-compaction deleted, single compaction hook owns compaction. Retained so existing configs keep loading. */
  z.literal("preemptive-compaction"),
  /** @deprecated no-op — removed with the background-agent subsystem. Retained so existing configs keep loading. */
  z.literal("background-notification"),
  /** @deprecated no-op — removed with the background-agent subsystem. Retained so existing configs keep loading. */
  z.literal("background-task-blocker"),
  /** @deprecated no-op — removed with the custom task delegation subsystem. Retained so existing configs keep loading. */
  z.literal("delegate-task-retry"),
  /** @deprecated no-op — the subagent-block hook was never implemented; name retained so existing configs keep loading. */
  z.literal("subagent-block"),
  /** @deprecated no-op — implementation removed (R17); name retained so existing configs keep loading. Remove in v3.0. */
  z.literal("unstable-agent-babysitter"),
])

export type HookName = z.infer<typeof HookNameSchema>

