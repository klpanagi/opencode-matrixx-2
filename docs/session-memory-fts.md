# Session Memory — Phase 2 FTS Design Note (DESIGN ONLY, NO CODE)

Status: **DEFERRED — v1 NO-GO for SQLite/FTS.** Phase 1 ships JSONL + verbatim
scan only (`src/features/session-memory/`). This note records options,
a JSONL-to-index migration sketch, and quota impact so Phase 2 can start
from a frozen decision point. No Phase 1 API changes implied.

Upstream pin: opencode-lcm `84103cca85b2324626a8b8df0f592a555fe8ac96`
(v0.15.1). Pinned quotas: `perMessageBudget 110`, `maxChars 900`,
`minTokens 2`, hits `2-1-1` (message/summary/artifact), scope scan budgets
`16-12-8-6`, `compactContextLimit 1200`, retention
stale `undefined` (disabled) / deleted `30d` / orphan `14d`.
File-backed precedent: `src/features/task-storage/storage.ts`
(`getTaskDir`, `writeJsonAtomic` tmp+rename, 30s stale lock) — copied verbatim
into `src/features/session-memory/storage.ts`
(`.matrixx/memory/memory.jsonl`, append-under-lock, per-line safeParse).

## Explicit v1 NO-GO

- **No SQLite dependency in v1** — no `better-sqlite3` / `bun:sqlite` /
  `node:sqlite` import, no native dep in `package.json`, no FTS5 virtual table,
  no index file written by any Phase 1 path (`appendMemoryEntry`, hook
  staging/flush, `recall`, `retention`, `summary`, `compacting`).
- Rationale: v1 correctness bar is deterministic verbatim scan with zero
  native deps and zero hot-path IO (hook stages to a bounded in-memory buffer,
  flush only on `session.idle` / `session.compacted`). FTS adds a native
  module, a second source of truth (index drift), and cross-platform build
  risk — out of scope for the interop MVP (plan KD-10).
- Negative check (must stay green through v1):
  `rg -i sqlite src/features/session-memory/ package.json` outputs 0 hits
  (verified 2026-10-26: exit 1, no matches; purity docstrings in `recall.ts` /
  `summary.ts` say "no index-engine" so even the literal token is absent).

## Options table

| # | Option | How it works | Pros | Cons | Verdict |
|---|--------|--------------|------|------|---------|
| A | **SQLite FTS5** (`better-sqlite3` / `bun:sqlite` sidecar `memory.db`) | Tokenizer index over entry text; BM25 rank; `doc_id → MemoryEntry.id` map | Ranking beats substring scan; prefix/phrase queries; proven pattern for local FTS | Native dep + build matrix (7 platform pkgs); index-drift risk (every append/prune must re-index under lock); lock contention with JSONL append path; backup story doubles | **Phase 2 candidate, v1 NO-GO** |
| B | **External index process** (e.g. sidecar search service / MCP-backed index) | JSONL ships lines out; external engine returns ranked `doc_id` list; plugin keeps JSONL as source of truth | No native dep in plugin; engine swappable | New deployment/moving part; IPC + auth + availability surface; overkill for per-project memory sizes | Rejected for Phase 2 unless memory volume justifies it |
| C | **JSONL scan (v1 status quo)** | `recall()` pure sync verbatim substring scan over scope-filtered candidates | Zero deps; pure/deterministic; trivially testable; no drift (single source of truth) | O(n) scan; no ranking beyond per-kind caps; substring-only (no stemming/phrase) | **v1 SHIP** — adequate at observed memory sizes; budgets bound the cost |

## JSONL-to-index migration sketch (Phase 2, if option A is chosen)

1. **JSONL stays source of truth.** Index is a derived cache at
   `<project>/.matrixx/memory/memory.db` (gitignored, same as `.matrixx/`
   today). Any index miss/corruption → rebuild from JSONL, never the reverse.
2. **Line → row mapping.** Each JSONL line parses to `MemoryEntry`; index row:
   `doc_id = entry.id` (stable, never reused), `rank` = BM25 score at query
   time (not stored), `tokens` = FTS5-tokenized `text` (whitespace-collapsed,
   same normalization as `recall()` today). Reserved fields `doc_id` / `rank`
   / `tokens` are index-only — never added to the `MemoryEntry` Zod schema
   (strict mode must keep passing on old lines).
3. **Build:** `buildIndex(directory)` reads via existing `readMemoryEntries()`
   (malformed lines skipped, same as today), inserts non-`removed` entries in
   one transaction. **Incremental:** `appendMemoryEntry` inserts the new row
   in the same lock acquisition; `prune` deletes `removed`/orphan rows or
   re-marks tombstones (tombstone semantics preserved — never hard-delete
   from JSONL; index may drop the row since JSONL is truth).
4. **Query path:** `recall()` gains an optional index-backed branch behind a
   config flag (default off, JSONL scan remains fallback). Same output
   contract: `RecallHit[]` with per-kind caps (`maxMessageHits 2`,
   `maxSummaryHits 1`, `maxArtifactHits 1`), per-message truncation
   (`perMessageBudget 110`), synthetic-prefix skip, `ignoreToolPrefixes`
   filter — ranking only reorders within caps, never widens them.
5. **Batch labels:** `propagateBatchLabels(commands)` titles become FTS5 chunk
   titles (already re-exported for this purpose); synthetic prefixes
   (`SYNTHETIC_MESSAGE_PREFIXES`) are excluded from the index at write time,
   mirroring the current write-path filter.

## Quota impact

All pinned quotas stay **unchanged** under FTS — ranking is a quality change,
not a budget change:

- `perMessageBudget 110`, `maxChars 900`, `compactContextLimit 1200`:
  truncation/render caps apply after ranking, identical code path
  (`truncateRecall` verbatim).
- Per-kind hits `2-1-1` + scope scan budgets `16-12-8-6`: the scan budget
  becomes a *candidate* budget (top-N from the index per scope instead of
  first-N from JSONL); hit caps still bound output tokens per turn.
- `minTokens 2` gate unchanged (still rejects single-token noise queries
  before touching the index).
- Retention (`stale undefined` / deleted `30d` / orphan `14d`, pinned-skip,
  tombstones) unchanged: prune drives index deletes, never the reverse.
- Net effect: same worst-case context-token cost per turn, better hit
  relevance. No quota re-tuning required for Phase 2 adoption.

## Decision log

- 2026-10-26: v1 ships option C (JSONL scan). Option A deferred to Phase 2
  with the migration sketch above. Option B rejected barring volume evidence.
  Design intent frozen — visual/layout N/A (no UI surface); Phase 1 APIs
  (`MemoryEntry`, `appendMemoryEntry`, `recall`, `prune`, `shapeSummaryNodes`,
  `getCompactingSnippet`) are unchanged by this note.
