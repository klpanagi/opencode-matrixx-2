export const STALENESS_GAP_CHECK_DESCRIPTION = `Deterministic, read-only checker for market-data feed health. Given a list of samples (or a newline-delimited JSON log) it detects per-(symbol,exchange) sequence gaps, regressions and duplicates, and classifies staleness (now - exchange_ts vs the expected inter-arrival interval). Returns a JSON report with a status exit code (0=clean, 1=warnings, 2=errors).

Staleness: expected interval is the median positive delta of exchange_ts within a group; state is healthy, warn (> maxGapMultiplier x expected, default 2x), or stale (> 5x expected). "now" defaults to the maximum pub_ts across the input (so the check is deterministic without a wall clock); pass "now" to override.

Providing neither samples nor logPath fails closed with status 2 rather than a clean pass.`

export const DEFAULT_MAX_GAP_MULTIPLIER = 2

export const STALE_MULTIPLIER = 5
