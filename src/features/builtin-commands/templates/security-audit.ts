export const SECURITY_AUDIT_TEMPLATE = `You are running a read-only deterministic security audit (v1 advisory-only).

## Usage

\`\`\`
/security-audit [--scope=file|module|project] [--target=<path>] [--full] [--budget=N]
\`\`\`

- --scope: file | module | project (default: file — scoped by default).
  - file: single --target path only.
  - module: the directory containing --target.
  - project: full tree.
- --target: path scoping the audit. Required for file and module scope; optional
  for project scope.
- Scoped-default disclaimer: a bare invocation without --scope audits a single
  file only when --target names a file; without --target it audits nothing and
  asks for a target. Broad project coverage is opt-in via --scope=project or
  --full — never assume full-tree scope from a bare invocation.
- --full: opt-in full-tree deep audit. COST WARNING: a full audit consumes
  roughly an order of magnitude more tokens than a scoped audit. Ask the user
  for confirmation before running --full on a large tree, and record the
  confirmation (or its absence) as evidence.
- --budget=N: finding budget gate. N is the maximum number of findings the run
  will fully evidence. When candidate findings exceed what the budget funds,
  the unfundable remainder is recorded as status deferred and the coverage
  ledger run status becomes incomplete (run_status incomplete).
- Invalid --scope value is a hard error: \`error: invalid --scope '<v>'
  (expected file|module|project)\`, exit 2, no report written. Example:
  --scope=bogus → error, exit 2.
- Finding lifecycle statuses (per FindingStatusSchema in
  src/skills/schemas/security-audit.ts): confirmed | needs_validation |
  rejected | deferred. needs_validation findings MUST NOT carry a severity.
- Coverage ledger unit statuses (per LedgerUnitStatusSchema): planned |
  not_applicable | out_of_scope | in_progress | covered | candidate | blocked |
  deferred. Ledger run status: complete | incomplete (budget gate).
- v1 advisory-only: this command never fails the build, never gates CI, only
  reports. Exit-code mapping 0/1/2 reserved: 0 = clean (no confirmed findings),
  1 = findings (one or more confirmed findings), 2 = invalid usage.

## WHAT TO DO, IN THIS ORDER

1. **Resolve the scope, or stop.** Parse --scope, --target, --full, and --budget
   from <user-request>. Resolve --target against the working tree. If the target
   is unresolvable (missing path, invalid --scope value, file or module scope
   without a target), ERROR AND STOP: state the scope, the target, and why
   resolution failed, and create no report files. Never proceed on an empty or
   partial resolution, and never substitute a different target.

2. **Gather read-only evidence.** All gathering is read-only: run nothing that
   mutates source, sends network probes, or executes untrusted code paths.
   Collect static evidence only (file reads, grep/ast-grep matches, LSP
   diagnostics as corroborating evidence). Record each input's raw output as
   evidence.

3. **Apply the budget gate.** When --budget=N is set and candidate findings
   exceed N, fully evidence at most N findings and mark the remainder deferred;
   set the coverage ledger run status to incomplete. Without --budget, the
   ledger run status is complete when every seeded unit reaches a terminal
   state (covered, not_applicable, out_of_scope, blocked, or deferred).

4. **Render and write the report.** Run \`mkdir -p .matrixx/audits/<run-N>\` in
   bash first, then write run-metadata.json, coverage-ledger.json
   (LedgerSchema: units plus status complete|incomplete), and findings.json
   (array of FindingSchema entries) together. \`generatedAt\` is a
   caller-supplied input — never self-generate it. Never touch source.

5. **Report the paths back to the user.** Give the absolute .matrixx/audits/<run-N>/
   directory path plus the exit code (0 clean, 1 findings, 2 invalid usage).
   Do not modify any plan.

## FORBID LIST — hard denials inside this audit

- NO Edit/Write to source files.
- NO lsp_rename.
- NO non-dryRun ast_grep_replace (dryRun preview reads are allowed; applying is denied).
- NO task_create / NO task_update.
- NO plan_update and never touch .matrixx/plans.
- NO network probes, NO live-target requests, NO execution of untrusted code.
- Writes = audit report files only: the ONLY writable paths are
  .matrixx/audits/<run-N>/run-metadata.json,
  .matrixx/audits/<run-N>/coverage-ledger.json, and
  .matrixx/audits/<run-N>/findings.json
  (after mkdir -p .matrixx/audits/<run-N>). No staging, no other writes.

<user-request>
$ARGUMENTS
</user-request>`
