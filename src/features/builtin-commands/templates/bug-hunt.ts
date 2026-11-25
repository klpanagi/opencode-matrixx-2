export const BUG_HUNT_TEMPLATE = `You are running a read-only evidence-graded defect hunt (EGDD, v1 advisory-only).

Suspect → oracle → witness → tier → severity. A hypothesis is not a finding, and no severity
is assigned without an evidence tier. This command never fails the build and never gates CI.

## Usage

\`\`\`
/bug-hunt [--scope=file|module|project] [--target=<path>] [--class=<odc-type|cwe-N|all>] [--depth=static|dynamic|deep] [--budget=N] [--verify=<run-N>]
\`\`\`

- --scope: file | module | project (default: file, and only when --target names a file;
  without a file target, error and ask for one).
  - file: single --target path only.
  - module: the directory containing --target.
  - project: full tree.
- --target: path scoping the hunt. Required for file and module scope. Must resolve inside
  the project root (see TARGET SAFETY).
- --class: ODC defect type (function | interface | checking | assignment | timing |
  build-package | documentation | algorithms | other) | cwe-N | all (default: all).
- --class=cwe-N is a filter, not a stored value: when you write the finding, normalize
  cwe to the canonical CWE-<number> form (--class=cwe-79 -> "cwe": "CWE-79").
- --depth: static (default; stages S0-S3 and S6-S9) | dynamic (adds S5 sanitizers and
  fuzzing) | deep (adds S4 CBMC/KLEE bounded verification). At static, S3 and S9 use
  only in-process oracles; any check that needs the test runner or a built target is
  recorded as blocked instead of being silently skipped.
- --budget=N: maximum number of fully-evidenced findings (default 20). The unfundable
  remainder is recorded as status deferred and the coverage ledger run status becomes
  incomplete.
- --verify=<run-N>: re-verify a prior run through the S9 fresh verifier pass; confirmed
  same-source findings are carried forward and everything changed is revalidated.
- Invalid --scope, --depth, or --class value is a hard error:
  \`error: invalid --scope '<v>' (expected file|module|project)\`, exit 2, no files
  written. Example: --scope=bogus → error, exit 2.
- Tool policy: detect-and-degrade. A missing tool marks the ledger unit blocked with
  exactly one install hint; silent coverage is forbidden.
- v1 advisory-only: exit-code mapping 0/1/2 — 0 clean (no confirmed findings), 1 findings
  (one or more confirmed findings), 2 invalid usage.

### Evidence ladder (per src/skills/loader/schemas/bug-hunt.ts)

| Tier | Name | What qualifies | Severity policy |
|------|------|----------------|-----------------|
| E3 | Proven | Formal counterexample, sanitizer crash, or exhaustive proof | severity optional |
| E2 | Reproduced | Minimized deterministic test/property stored under \`.matrixx/bugs/<run-N>/reproducers/\` | severity optional; reproducer required |
| E1 | Witnessed | Static invariant violation plus a concrete slice witness | severity optional; capped at medium |
| E0 | Candidate | LLM-only suspicion or unproven pattern match | status needs_validation required; no severity |

**Finding field formats:** \`reproducer\` is relative to the run directory and starts with
\`reproducers/\` (\`reproducers/case1.test.ts\`); the \`.matrixx/bugs/<run-N>/\` prefix belongs to
prose, not to the field, and the schema rejects it. \`location.path\` is a project-relative
source path with no .. segment and no absolute prefix.

## TARGET SAFETY — hard rules

1. \`--target\` must resolve inside the project root. If it does not, hard-error with exit 2
   and write nothing.
2. Never read or copy secret material: skip \`.env*\`, \`*.pem\`, \`*.key\`, \`id_*\`,
   credential stores, and any file the user marks excluded. Never print or persist secret
   values in any artifact field.
3. \`--depth=dynamic\` or \`deep\` builds and executes project code (S4/S5 and the test runner).
   The trust prerequisite is explicit: only the current checkout, under the user's trust,
   may be built or executed. For a third-party or untrusted \`--target\`, S5 is \`blocked\`
   and recorded as such — never silently skipped.

## WHAT TO DO, IN THIS ORDER

1. **S0 Frame.** Build the ODC model for the scope, inventory available oracles into
   tools[], and seed the coverage ledger units. Resolve --scope, --target, --class,
   --depth, --budget, and --verify first; if resolution fails, ERROR AND STOP with exit 2
   and write nothing.
2. **S1 Invariant mining.** Mine Engler deviant-behavior invariants from call sites
   (trinity for call-site mining). Read-only.
3. **S2 Static semantic analysis.** Run clang-tidy, typecheck, taint, and slicing per the
   tool matrix. Read-only.
4. **S3 Contract and property synthesis.** Author Hoare/DbC contracts and
   QuickCheck-style properties as the oracle; write every property test under
   \`.matrixx/bugs/<run-N>/reproducers/\`. Never apply generated code to source.
5. **S4 Bounded verification.** CBMC/KLEE only when --depth=deep; otherwise mark the unit
   not_applicable.
6. **S5 Directed fuzzing and sanitizers.** Only when --depth is dynamic or deep.
7. **S6 LLM hypothesis generation.** Generate suspects with IRIS/LLift/RepoAudit/Big
   Sleep-style patterns; every output starts at E0 with status needs_validation.
8. **S7 Reduction and root cause.** Run ddmin (Zeller), write the minimized reproducer to
   \`.matrixx/bugs/<run-N>/reproducers/\`, and promote to E2 only when the reproducer is
   deterministic.
9. **S8 Fault localization.** Rank suspects with Tarantula/Ochiai spectra and program
   slicing (trinity owns slicing; merovingian may assist hard reasoning).
10. **S9 Adversarial validation.** Run a fresh verifier pass (hunter is not verifier).
    Promote E0→E1→E2→E3 only with an oracle witness. Security-class findings are delegated
    to the security-audit skill / security-* skills and recorded as cross_ref — never
    reimplemented here.
11. **Allocate the run directory.** Create \`.matrixx/bugs/\` if it does not exist, then
    create the next free \`run-<n>\` inside it exclusively (\`mkdir\` without \`-p\` on the run
    dir, incrementing n on EEXIST); never reuse an existing run id. Validate any run id
    taken from \`--verify\` against \`^run-[1-9][0-9]*$\` before using it in any shell command.
    Write run-metadata.json, coverage-ledger.json, findings.json, and the reproducers/
    directory together.
12. **Report.** Give the absolute .matrixx/bugs/<run-N>/ path, the per-tier counts
    (E0,E1,E2,E3), and the exit code (0 clean, 1 findings, 2 invalid usage). Do not modify
    any plan.

## AGENT ROSTER

- S0 framing and oracle inventory → oracle.
- S1/S2 mining and slices → trinity.
- S3/S7 oracle and reproducer authoring
  (all artifacts under .matrixx/bugs/<run-N>/reproducers/) → mouse-source.
- S6 hypothesis and S9 adversarial reasoning → merovingian.
- S8 fault localization and slicing → trinity (merovingian may assist hard reasoning).
- Security-class delegation → sentinel plus the security-audit skill: record cross_ref only,
  do NOT start a security-audit run, and do NOT write .matrixx/audits/.

## FORBID LIST — hard denials inside this hunt

- NO Edit/Write to source files.
- NO lsp_rename.
- NO non-dryRun ast_grep_replace (dryRun preview reads are allowed; applying is denied).
- NO task_create / NO task_update.
- NO plan_update and never touch .matrixx/plans.
- NO network probes, NO execution of untrusted code.
- NO git state changes (add, commit, stash, checkout, reset, clean, push).
- NO publishing or installing dependencies (npm/bun/yarn publish, npm install, bun add, pip install, cargo install).
- Writes = hunt artifacts only: the ONLY writable paths are
  .matrixx/bugs/<run-N>/run-metadata.json,
  .matrixx/bugs/<run-N>/coverage-ledger.json,
  .matrixx/bugs/<run-N>/findings.json, and
  .matrixx/bugs/<run-N>/reproducers/**
  (after creating the run directory exclusively). No staging, no other writes.

<user-request>
$ARGUMENTS
</user-request>`
