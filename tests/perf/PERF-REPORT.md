# Performance Optimizations: Measurement Roll-Up

**Plan:** performance-optimizations
**Date:** 2026-11-25
**Method:** measurement-gated; ≥10% p50 gate; bench not wired into CI

## Verdict table

| Task | Area | Verdict | Before → After | Note |
|---|---|---|---|---|
| T1 | Bench harness + baseline | MEASUREMENT | dist/index.js 3.28MB; 5356 tests; ~638 sync-fs | no src change |
| T2 | rules-injector cache | SHIPPED | p50 0.1422ms → 0.0002ms (−99.86%) | 0 fs on cache hit |
| T3 | event dispatch index | SHIPPED | p50 0.0370ms → 0.0239ms (−35%) | 18 serial no-op awaits indexed |
| T4 | tool-execute-after waves | SHIPPED | p50 20.3ms → 12.8ms (−37%) | 19→12 turns; mutators sequential |
| T5 | chat-message parallel | REJECTED | p50 0.0043ms → 0.0042ms (parity) | fails ≥10% gate; awaits 7→5 |
| T6 | rtk spawn avoidance | SHIPPED | spawns 10 → 0 (passthrough); p50 −99.97% | eligible path byte-identical |
| T7 | gitleaks staged batching | SHIPPED | scans 30 → 1; p50 −99.99% | identical findings |
| T8 | skills lazy import | SHIPPED | dist 3,435,442B → 1,039,280B (−69.75%); import p50 ~6.0→~1.19ms (−80%) | hydration 0.35→10.8ms tradeoff; require() + --splitting rulings |
| T9 | async JSON writes | SHIPPED | meta bytes 472→349 (1.352×); per-msg 1.298× | writeFileSync eliminated |
| T10 | context-mode memo | SHIPPED | fs ops 2000 → 0 (100%) | target ≥95% |
| T11 | comment-scan temp dir | SHIPPED | 40 → 1 mkdtemp; p50 0.0709→0.0384ms (−46%) | process-lifetime temp dir |
| T12 | bounded LRU caches | SHIPPED | caps at 1000, oldest-first | rules-injector + uiux/python |
| T13 | connected-providers cache | NO-OP | 1 existsSync, 0 readFile/JSON.parse per call | premise wrong; src unchanged |
| T14 | Roll-up + report | MEASUREMENT | 13 prior tasks summarized | this report |

## Rulings

- **T5 rejected on gate.** Chat-message parallelization measured p50 parity (0.0043ms → 0.0042ms), which fails the ≥10% gate. The structural reduction (serial awaits 7 → 5, −28.6%) is retained as behavior-preserving, but the task is recorded as REJECTED, not SHIPPED.
- **T8 require() + --splitting.** The plan specified `import()` for the skills loader, but the implementation uses `require()` because `BuiltinSkill.template` is synchronous and there are 6 sync call sites. `--splitting` was added to `package.json`'s `build:plugin` because it is necessary for the dist/index.js shrink (3,435,442B → 1,039,280B). First full hydration regressed 0.35ms → 10.8ms as an accepted tradeoff.
- **T13 no-op.** Measurement showed 1 existsSync + 0 readFileSync/JSON.parse per call; the premise of 3 fs ops per call was wrong. Nothing to memoize; src unchanged; bench + test added anyway.

## Cross-plan hand-offs

- The bugs-remediation plan is COMPLETE (19/19), so its event.ts error-isolation work was available and was consumed by T3 (event dispatch index).
- No other cross-plan work was consumed by this plan. Security and other plans own their own files; this plan touched none of them.

## Known-good untouched

Verified by empty git diff over the known-good and MUST-NOT-TOUCH paths (logger, task-storage, task-session-scope, plugin/message-hooks, tools/plan, tool-execute-before, sdk-message-cache, tool-metadata-store, compress-watchdog, keyword-detector). `git diff --stat` over those paths produced no output.

## How to run benches

- Full baseline capture: `bun run tests/perf/capture-baseline.ts`
- Individual benches: `bun test <file>` against any `*.bench.ts` under `tests/perf/`
- Bench files are NOT wired into CI. `script/mock-heavy-list.txt` is untouched.
