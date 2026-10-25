/**
 * Silent-failure guard scope.
 *
 * The guard fires only for writes/edits to Python files whose path matches one
 * of the finance-path globs below. Kept as a named constant so the scope can be
 * made configurable later without touching the hook logic.
 */
export const FINANCE_PATH_GLOBS: string[] = [
  "**/price_publisher/**",
  "**/recorder/**",
  "**/telegram_bot/**",
  "**/pipeline/**",
  "**/ingest*/**",
  "**/exchange*/**",
]

/** Tools whose completion can introduce a silent failure. */
export const SILENT_FAILURE_GUARD_TOOLS: string[] = ["edit", "write"]

/** Max findings surfaced per write (strict budget — never floods context). */
export const SILENT_FAILURE_GUARD_MAX_FINDINGS = 5

/** Skip files larger than this (bytes) to keep the guard light. */
export const SILENT_FAILURE_GUARD_MAX_CONTENT_BYTES = 512_000
