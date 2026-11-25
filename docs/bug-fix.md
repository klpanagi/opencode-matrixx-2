# /bug-fix — Plausible-Patch Pipeline

`/bug-fix` is the write-capable sibling of `/bug-hunt`. It consumes an existing
hunt run (`.matrixx/bugs/<run-N>/`), attempts a candidate patch for each
eligible finding inside a separate git worktree, and delivers the result as a
DRAFT pull request for human review. It never merges. It never touches a
`/bug-hunt` run's own artifacts: the run directory is read-only input except
for the `fixes/` subtree this command creates.

The command has one sentence at its core: **A plausible patch is not a correct
patch.** The gates below do not erase that sentence; they measure how far a
candidate sits from it. What the pipeline calls "plausible" is precisely
defined in [Status vocabulary](#status-vocabulary), and
[What this does not prove](#what-this-does-not-prove) states the empirical
limits in plain numbers.
This document is a reference for anyone running `/bug-fix`, reviewing its
output, or extending its stage pipeline. The `bug-fixing` skill is the
authority for the stage exit criteria and the forbidden-edit list; this page
summarizes them.
---
## Why a candidate, not a fix
Passing the test suite is evidence, not proof. The automated-repair literature
puts numbers on how weak that evidence is: in Smith et al. the median GenProg
patch that passed its entire training suite still passed only 75% of an
independent suite (mean 68.7%) (Smith et al., ESEC/FSE 2015, DOI
10.1145/2786805.2786825), and of the 181 plausible GenProg, RSRepair and AE
patches the authors analysed by hand only 7 were correct, under 4% (Qi et al.,
ISSTA 2015, DOI 10.1145/2771783.2771791).
So this pipeline refuses the vocabulary of success. Nothing in it says a bug
is gone. It says: here is a patch, here is a reproducer that failed on the
base commit and passes on the patched worktree, here is a suite that stayed
byte-identical, here is a coverage map, and here is a fresh verifier's audit.
That bundle is a claim. The gates are the evidence the claim is allowed to carry.
A human decides whether the claim survives.
Two design consequences follow from that framing:
- **Delivery is a draft.** Every plausible patch becomes a DRAFT pull request
  from a dedicated branch. No merge, no squash, no push to `dev`, ever. The
  command opens the PR; a human merges it.
- **Records outlive attempts.** Rejected, abandoned, and unreproducible
  attempts are written down with a reason. An attempt that produced nothing is
  still an outcome, and the artifacts directory shows it.
---
## Usage and flags
```
/bug-fix <run-N> [--fix-budget=5] [--max-attempts=3] [--min-severity=medium] [--mutation] [--allow-exec] [--verify]
```
`<run-N>` is a run id allocated by `/bug-hunt` (`run-[1-9][0-9]*`). If the run
directory does not exist, or its `run-metadata.json` is missing or malformed,
the command exits `2` and writes nothing. There is no implicit "fix whatever
you find" mode: `/bug-fix` only consumes runs that `/bug-hunt` produced.
| Flag | Default | Rule |
|------|---------|------|
| `<run-N>` (positional) | required | Matches `run-[1-9][0-9]*`; the run directory must exist with `run-metadata.json`, else exit `2` |
| `--fix-budget` | `5` | Integer >= 1; maximum fixes attempted in this invocation |
| `--max-attempts` | `3` | Integer 1..5; patch attempts per fix |
| `--min-severity` | `medium` | Ladder rank; findings below it are counted as skipped, not recorded |
| `--mutation` | off | Enables G5 mutation testing on the touched files |
| `--allow-exec` | required | Absent => `error: --allow-exec is required (this command executes reproducers)`, exit `2`, nothing written |
| `--verify` | off | Re-runs independent verification on existing plausible records in the run; no new patch, no new commit, no new draft PR |
An unknown flag is `error: invalid flag '<flag>'`, exit `2`. An invalid value
is `error: invalid value for '<flag>'`, exit `2`. No files are written on
exit `2`.
### Exit codes
| Code | Meaning |
|:---:|---------|
| `0` | Nothing plausible: no plausible record was produced by this invocation (includes all-ineligible, all-unreproducible, and a successful `--verify`) |
| `1` | One or more plausible patches awaiting human review (draft PRs opened) |
| `2` | Invalid usage: bad or missing run id, missing `--allow-exec`, bad flag or value, absent run metadata; nothing is written |
| `3` | All attempts rejected (at least one rejected, zero plausible), the circuit breaker tripped, or `--verify` downgraded at least one plausible record |
Precedence: `2` > `1` > `3` > `0`.
Exit `3` also fires on the circuit breaker: after 2 consecutive rejected
fixes, the pipeline stops and writes the remaining eligible findings as
abandoned with terminal reason `circuit breaker: 2 consecutive rejections`.
A successful `--verify` exits `0` because nothing new is awaiting review; the
plausible record already existed and the human had it. A `--verify` that
downgrades at least one record to `rejected` exits `3`.
---
## Eligibility
Only findings the hunt actually proved are eligible. A patch attempt on an
unverified hypothesis would be guesswork with a diff attached.
| Tier | Treatment |
|------|-----------|
| E3 (proven) | Eligible |
| E2 (reproduced, reproducer required) | Eligible |
| E1 (witnessed) | Refused with a reason: a complete abandoned record with `ineligible.reason` (for example `ineligible: tier E1 (requires E2/E3)`) and attempts 0 |
| E0 (candidate) | Refused the same way, for example `ineligible: tier E0 (requires E2/E3)` |
| Any tier with a `cross_ref` | Excluded: the finding belongs to `/security-audit`, recorded as `excluded: cross_ref security finding` |
Ineligibility is classified first: every E0/E1 and cross_ref finding is
recorded as a complete abandoned record regardless of severity. Only the
remaining eligible findings are then filtered by `--min-severity`, and those
below it are skipped, not recorded; the report counts them. Eligible findings
are ordered by severity descending, tier descending, fingerprint ascending,
and the pipeline takes at most `--fix-budget`.
Security-class findings never become patches here. Delegation stays with
`/security-audit`; `/bug-fix` records the cross-reference and moves on.
---
## The F0-F6 pipeline
The pipeline runs F0 through F6 in order. Each stage has a purpose, an owner,
and an exit criterion; a stage that cannot meet its criterion does not
silently pass.
| Stage | Name | Purpose | Owner | Exit criterion | Artifact |
|-------|------|---------|-------|----------------|----------|
| F0 | Intake and flag resolution | Validate run id and flags; read run metadata and findings | Top-level session | Flags valid, run readable, `--allow-exec` enforced; otherwise exit `2` and write nothing | Nothing (in memory) |
| F0b | Eligibility gate | Select E2/E3 findings, refuse the rest, order and cap | Top-level session | Eligible list built; every refusal recorded as a complete abandoned record | `fixes/` refusal records |
| (setup) | Worktree and branch | One separate git worktree per fix; branch `fix/bug-hunt-<run-N>` created from the run's base commit and reset to that base before each fix, so it never carries an earlier rejected commit | Top-level session | Session moved into the worktree; the primary checkout is never touched | Worktree |
| F1 | Reproducer trust | Prove the reproducer fails deterministically on a pristine checkout | mouse-source | 3/3 runs exit non-zero with identical signatures, else `unreproducible` and this fix stops | `evidence/` run outputs |
| F2 | Localize | Rank suspect files and lines | merovingian (read-only) | Suspect set recorded in notes; output is advisory only | Notes in evidence |
| F3 | Patch | Edit inside the worktree only: at most 3 files, at most 60 changed lines, exactly one logical change | mouse-source | Diff written to `patches/`, commit created; static checks green; failures consume an attempt and loop | `patches/<fingerprint>.diff` |
| F4 | Gates G1-G5 | Run the five gates (see next section) | Top-level session | All required gates pass; G5 optional | Gate evidence under `evidence/` |
| F5 | Independent verification | A fresh verifier re-checks everything in a clean checkout | merovingian (fresh, read-only) | Verifier passes, else `rejected` | Audit notes |
| F6 | Record and report | Write the fix record last, open the draft PR, clean up | Top-level session | Record written atomically; PR drafted for plausible only; worktree removed | `fixes/fix-<encoded-fingerprint>.json` |
Stage notes:
- **F1 comes before any edit.** The reproducer runs 3 times on a pristine
  checkout of the base commit, with cwd at the checkout root, a 120 s timeout
  per run, and a 64 KiB output cap. 3/3 non-zero exits plus identical
  signatures is the minimum bar for trusting the reproduction. Any exit 0, or
  any signature divergence, writes an `unreproducible` record
  (`deterministic: false` when the divergence is the cause) and the fix stops.
- **F3 is bounded on purpose.** At most 3 files, at most 60 changed lines, one
  logical change. The diff is written to `patches/` before the commit exists,
  so a failed commit leaves a diff but no record, which the pipeline treats as
  "not completed", never as plausible.
- **Commits are named carefully.** The commit message names only the run and
  the fingerprint ("candidate patch for <fingerprint>"): no gate outcome is
  claimed, because F4 has not run when the commit is created. It never contains
  the words "fixed" or "correct".
- **F6 writes last.** The fix record is written only after the commit hash and
  every gate result exist, via an atomic temp-file-plus-rename write. A crash
  at any earlier point leaves no plausible record behind.
- **Cleanup.** The worktree is removed on success and on abort. A rejected
  commit is exported as a patch file and dropped when the branch is reset to
  the base for the next fix, so a later plausible draft PR never bundles it.
---
## Gates G1-G5
| Gate | What it checks | Pass criterion | Command shape |
|:---:|----------------|----------------|---------------|
| G1 | Test integrity | Every pre-existing `tests/**` path is byte-identical (sha256 manifest at base, recomputed after the patch); the only permitted delta is exactly one new `tests/<mirrored-path>-regression.test.ts` that failed on the pristine checkout and is recorded separately | `git ls-files -z 'tests/**' \| xargs -0 sha256sum` at base, then recompute |
| G2 | Reproducer flip | 3/3 runs of the trusted reproducer exit 0 on the patched worktree | `timeout 120s bun test <absolute reproducer path>` (cwd = worktree root), 3x |
| G3 | Full suite | The project's full test run is green and leaves `assets/`, `tests/`, and `bun.lock` unchanged | `bun run test`, then `git status --porcelain assets tests bun.lock` |
| G4 | Coverage on changed lines | Coverage over the reproducer run proves every changed line in the touched files executes (hit count > 0) | `bun test --coverage --coverage-reporter=lcov <abs reproducer>`, parse `DA:<line>,<hits>` |
| G5 | Mutation testing (optional) | StrykerJS on the touched files; the score must not drop below baseline | `stryker run --mutate <touched files> --incremental` |

Each run is stored, not summarised: `pristine_runs` holds one entry per pristine attempt with
its exit code and signature hash (unique attempt numbers, all non-zero exits, all hashes equal
to `signature_hash`, length equal to `pristine_failures`), and `patched_runs` holds one entry per
patched attempt with its exit code (length equal to `patched_passes`, all zero).

Gate rules:
- G1's exception is exactly one file. The new regression test must be a
  structural proof of the defect (given/when/then over the behavior, not a
  boolean or a renamed copy), it must have failed on the pristine checkout,
  and it is recorded separately from the gate manifest. Editing any
  pre-existing test file fails G1, full stop.
- G2 and F1 are the same runner under two conditions: the reproducer must fail
  3/3 on the base commit and pass 3/3 on the patched worktree. A patch that
  only flips the reproducer sometimes is not trusted; signature determinism is
  re-checked in F5. An unreproducible record carries no patch, no gates, and no
  post-patch runs — the schema refuses them.
- G5 runs only with `--mutation`. StrykerJS absent means G5 is `blocked`, plus
  exactly one install hint, never a silent skip. Without `--mutation`, G5 is
  omitted from the record entirely; a non-pass G5 is only valid when the flag
  was passed. StrykerJS is not installed in this
  repository, so in practice G5 stays `blocked` until a human adds the tool.
- `finding.severity` is required for every non-abandoned record, and `finding.reproducer`
  is required whenever a patch exists (so every plausible record carries it); an abandoned
  record may omit both, because E0/E1 and cross_ref findings are never eligible for a patch.
- A gate result is `pass`, `fail`, `blocked`, or `skipped`; `blocked` requires
  an install hint. All of G1-G4 must pass before independent verification
  runs; a blocked G5 is permitted only when `--mutation` was passed.
---
## Independent verification
F5 is a second opinion, not a formality. A fresh verifier instance, working in
a clean checkout at the fix commit, re-runs:
1. **G2 again**: 3/3 reproducer passes on the clean checkout.
2. **G1 spot hashes**: sample of the test manifest, re-hashed.
3. **The overfit audit**: the diff is read against the classic failure modes
   of automated repair: assertion constants copied from the tests' expected
   values, early returns keyed to the reproducer's inputs, skipped or weakened
   tests, try/catch blocks that swallow the failure, edits to test helpers or
   global setup, and files outside the suspect set.
A failed verification flips the status to `rejected` with the failed check as
the terminal reason. No plausible record is written on a failed verification.
`--verify` re-runs this stage on existing plausible records in the named run.
It creates a throwaway worktree at each fix commit, re-runs G2 and G4, and
re-runs the overfit audit with a fresh verifier. It never patches, never
commits, never opens a new draft PR. A failed re-verification marks the record
rejected and closes its draft PR. The remaining flags are ignored except that
`--mutation` may add G5 to the re-run.
---
## Status vocabulary
Every fix record carries exactly one status. There are four, and the pipeline
never uses the words "fixed" or "correct" as statuses or claims.
| Status | Meaning |
|--------|---------|
| `plausible` | The patch passed G1-G4 and independent verification; it awaits human review via its draft PR. Plausible means the evidence held up, nothing more |
| `rejected` | A gate, static check, or the independent verifier refused the patch; `terminal_reason` names the failed check |
| `abandoned` | The fix never ran its course: ineligible finding, operator abort, or circuit breaker; `terminal_reason` says which |
| `unreproducible` | The reproducer did not fail deterministically on the pristine checkout (any exit 0, or signature divergence; `deterministic: false` marks divergence) |
The sanctioned summary of the whole vocabulary is one sentence: **A plausible
patch is not a correct patch.** Artifacts use the four statuses; they do not
contain affirmative claims about a patch being right.
---
## Artifacts
A run's fix artifacts live under the hunt run's directory:
```
.matrixx/bugs/<run-N>/fixes/
├── fix-<encoded-fingerprint>.json   # one record per attempted finding, written last
├── patches/                         # <fingerprint>.diff per attempt, written before its commit
└── evidence/                        # reproducer outputs, gate outputs, verifier audit notes
```
| Path | Contents |
|------|----------|
| `fix-<encoded-fingerprint>.json` | The record: status, gate results, patch file list and commit hash, terminal reason, evidence paths |
| `patches/<fingerprint>.diff` | The diff for an attempt, written before any commit. Record path fields (`diff_path`, `evidence_path`) are relative to `fixes/`, so they start with `patches/` or `evidence/` |
| `evidence/` | Raw reproducer run outputs (capped at 64 KiB each, truncation noted in `notes`), gate outputs, coverage data, verifier audit notes |
`.matrixx/` is gitignored, so fix artifacts stay local to the checkout and are
never committed. The record is written last and atomically, so a crash cannot
leave a half-written record: the worst case is a branch whose record is
missing, and a missing record means "not completed", never plausible. The
schema checks shape, not whether evidence files exist, so a hand-written
record can describe what never happened; that is what human review is for.
`findings.json` and `reproducers/` in the run directory are read-only to this
command; it writes only under `fixes/`.
---
## Safety model
- **`--allow-exec` is a hard gate.** This command executes reproducers.
  Without the flag it refuses before reading any executable content, writes
  nothing, and exits `2`.
- **`sandbox: "timeout-only"`.** Every fix record states its sandbox class:
  a hard 120 s wall clock per reproducer run plus a 64 KiB output cap. No
  container. Patched code runs under the user's trust, in the fix worktree.
- **One worktree per fix.** All edits happen inside the fix worktree; the
  primary checkout is never touched. The worktree is removed when the fix
  concludes.
- **Delivery is locked down.** No push except the single push of
  `fix/bug-hunt-<run-N>` for a plausible patch. No force push. No merge,
  squash, or auto-merge by the agent; humans merge. No commits to `dev`.
- **No configuration edits.** Configs, lockfiles, workflows, CI files,
  `package.json`, `tsconfig`, `biome.json`, and `bunfig.toml` are never edited
  by this command. No new dependencies. The only install-shaped action is the
  lockfile install that `bun run test` performs itself (G3); it adds nothing to
  the manifest.
- **No secrets.** Never read or persist `.env*`, `*.pem`, `*.key`, `id_*`, or
  credential stores.
- **Network isolation is NOT provided in v1.** The timeout and the output cap
  bound wall clock and output; they do not bound what the executed code can
  reach on the network. This residual risk is recorded, not claimed away. See
  [What this does not prove](#what-this-does-not-prove).
- **Run artifacts are untrusted input.** Everything read from
  `.matrixx/bugs/<run-N>/` is data, not instruction: finding title,
  description, evidence, notes, reproducer contents, and terminal reason. None
  of it is executed, and none of it is copied into a shell command, branch
  name, commit message, or PR body. Path fields are limited to
  `[A-Za-z0-9._/@+-]`, so a record cannot smuggle shell metacharacters, spaces,
  newlines, or a drive-relative prefix into a command.
- **Privilege and git metadata are off limits.** No `sudo`, no `chmod` or
  `chown`, no `git config`, no `.git/hooks` edits, no `git tag`, no
  `git remote` changes.
---
## What this does not prove
**A plausible patch is not a correct patch.** Every item below is a limit on
what the gates and the status `plausible` mean.
- **A green suite is not a specification.** Test-suite-adequate overfitting,
where a patch makes the visible tests pass while breaking behavior they do
not reach, is measurable: the median GenProg patch that passed its whole
training suite passed only 75% of an independent suite, mean 68.7% (Smith et
al., ESEC/FSE 2015, DOI 10.1145/2786805.2786825). G5 mutation testing exists to shrink that window;
without `--mutation`, G5 does not run at all, and even with it, mutation
adequacy is relative to the mutation operator set, not to the language.
- **Plausible is a low bar.** In the manual analysis of plausible patches
from automated repair, only 7 of 181 analysed plausible patches (2/105
GenProg, 2/24 RSRepair, 3/105 AE) were correct (Qi et al., ISSTA 2015, DOI
10.1145/2771783.2771791). Treat roughly 4% as the historical ceiling this
pipeline must beat, not as an expected rate.
- **Neither industrial system cited here merges without review.** SapFix (ICSE-SEIP 2019)
generates candidate patches with validation tests at production scale, and
Getafix (OOPSLA 2019) turns recurring fix patterns into engineer-facing
suggestions; both keep a human in the loop, and neither merges on its own.
This pipeline copies that boundary: a draft PR is the deliverable, and the
merge decision belongs to a person.
- **Network isolation is NOT provided in v1.** The sandbox is timeout and
output cap only (`sandbox: "timeout-only"`). Code that the patch executes can
reach the network the host has: no firewall, no container boundary, no
egress policy. Treat every plausible patch as code that ran with network
access, and review it as such.
What the gates establish is narrower than "the bug is gone": they establish
that the reproducer flipped deterministically, the suite stayed byte-identical,
the whole suite ran green, the changed lines executed under coverage, and a
fresh verifier found no overfit pattern. They do not prove intent, side effects on
behavior the tests do not reach, performance, or security. The record is a
claim, the gates are the evidence the claim may carry, and the human is the
decider.
---
## Boundaries
`/bug-fix` shares a neighborhood with other commands and skills. The table
separates them so runs do not duplicate work or blur authority.
| Neighbor | It owns | `/bug-fix` does | Cross-reference |
|----------|---------|-----------------|-----------------|
| `/bug-hunt` | Finding and grading defects (E0-E3), read-only | Consumes the run id `/bug-hunt` produced; during a hunt it does nothing, and it never writes inside the run's ledger or reproducers | Yes: `<run-N>` comes from a completed hunt run |
| `/security-audit` | Security vulnerability classes (CWE-style findings) | Never patches security-class findings; records the `cross_ref` exclusion and leaves the class to that command | Yes, mandatory for any security-class finding |
| `systematic-debugging` (skill) | A known, already-failing behavior being debugged interactively | Different entry point: debugging walks a live failure with the engineer; `/bug-fix` consumes graded evidence and patches in isolation | Optional |
| `quality-gate` (skill) | Post-merge quality verification (lint, typecheck, test, build) | Complementary: `/bug-fix` verifies a candidate before review; `quality-gate` guards the tree after it lands | Optional |
The security exclusion rule is strict: a finding with a `cross_ref` is
recorded as excluded and never becomes a patch attempt here. Running
`/security-audit` and `/bug-fix` over related findings is legitimate; each
keeps its own artifacts.
---
## Citation base
Most claims in this document trace to an entry below; where a claim is not
covered, its status is stated inline in the text.
| Work | Authors | Venue + Year | Identifier | What it grounds |
|------|---------|--------------|------------|-----------------|
| Manual analysis of plausible patches from automated program repair (7 of 181 correct) | Qi et al. | ISSTA 2015 | DOI 10.1145/2771783.2771791 | "What this does not prove": plausible is a low bar; the human-review requirement |
| Overfitting in automated program repair (median training-suite-passing GenProg patch passed 75% of an independent suite) | Smith et al. | ESEC/FSE 2015 | DOI 10.1145/2786805.2786825 | "What this does not prove": a green suite is not a specification; why G5 exists |
| SapFix | Marginean et al. (Facebook) | ICSE-SEIP 2019 | DOI omitted | Industrial practice: candidate patches plus validation tests at scale, human decides, never auto-merge |
| Getafix | Bader, Scott, Pradel, Chandra | OOPSLA 2019 | DOI omitted | Industrial practice: recurring fix patterns as engineer-facing suggestions, humans in the loop |
