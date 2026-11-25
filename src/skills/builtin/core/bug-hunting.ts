import type { BuiltinSkill } from "../../loader/types"

export const BUG_HUNTING_SKILL_NAME = "bug-hunting"

const BUG_HUNTING_SKILL_DESCRIPTION =
  "Use when hunting defects with evidence grading, building executable oracles, or triaging LLM-suspected bugs — EGDD 10-stage method with E0-E3 evidence ladder and read-only advisory rules. Related: systematic-debugging, security-audit."

export const bugHuntingSkill: BuiltinSkill = {
  name: BUG_HUNTING_SKILL_NAME,
  description: BUG_HUNTING_SKILL_DESCRIPTION,
  template: `# Bug Hunting — Evidence-Graded Defect Discovery (EGDD)

## THE RULE

No severity without an evidence tier. A hypothesis is not a finding.

Hunt in this order: suspect → oracle → witness → tier → severity. Severity is the last
field written and the first field removed when evidence is missing.

---

## EVIDENCE LADDER

| Tier | Name | What qualifies | Severity policy |
|------|------|----------------|-----------------|
| E3 | Proven | Formal counterexample, sanitizer crash with stack, or exhaustive proof over the bounded domain | severity optional |
| E2 | Reproduced | Minimized deterministic test or property in .matrixx/bugs/<run-N>/reproducers/ that fails every run on the target | severity optional; reproducer required |
| E1 | Witnessed | Static invariant violation plus a concrete slice witness (data/control path shown) | severity optional; capped at medium |
| E0 | Candidate | LLM suspicion, pattern match, or unproven reading of the code | status needs_validation required; no severity |

Schema source of truth: src/skills/loader/schemas/bug-hunt.ts (E0 forbids severity and
requires needs_validation; E1 is capped at medium; the reproducer is required at E2 and
optional at E3).

Finding field formats: reproducer is relative to the run directory and starts with
reproducers/ (reproducers/case1.test.ts); the .matrixx/bugs/<run-N>/ prefix does not belong
in the field and the schema rejects it. location.path is a project-relative source path with
no .. segment and no absolute prefix.

Depth gating: at --depth=static, S3 and S9 use in-process oracles only; any check that needs
the test runner or a built target is recorded as blocked, never silently skipped.

---

## 10 STAGES

Each stage states its purpose, oracle type, exit criterion, tool policy, and artifact.

### S0 — Frame

- Purpose: fix scope, depth, class filter, and the ODC defect model for this run.
- Oracle: inventory of available oracles and their versions.
- Exit criterion: coverage ledger seeded with every in-scope unit.
- Tool policy: detect-and-degrade; missing oracle becomes a blocked unit with one install hint.
- Artifact: coverage-ledger.json units plus the tool inventory.

### S1 — Invariant mining

- Purpose: mine deviant-behavior invariants (Engler-style) from call sites.
- Oracle: invariant statements derived from dominant usage patterns.
- Exit criterion: every mined invariant has a witness candidate or an explicit rejection.
- Tool policy: read-only grep/ast-grep/LSP mining; no mutation.
- Artifact: invariant list attached to the ledger units.

### S2 — Static semantic analysis

- Purpose: typecheck, taint, and slicing passes over the in-scope units.
- Oracle: compiler/typechecker diagnostics and taint reachability.
- Exit criterion: each unit marked covered, blocked, or out_of_scope.
- Tool policy: clang-tidy for C/C++, go vet for Go (best-effort), native typecheck for TS/JS, Python, Rust.
- Artifact: witness notes per candidate.

### S3 — Contract and property synthesis

- Purpose: author Hoare/DbC contracts and QuickCheck-style properties as the oracle.
- Oracle: property tests written under .matrixx/bugs/<run-N>/reproducers/, never applied
  to source.
- Exit criterion: each property either passes or yields a failing witness.
- Tool policy: test authoring only; source stays untouched.
- Artifact: property tests plus their witness output.

### S4 — Bounded verification

- Purpose: prove or refute candidates with CBMC or KLEE.
- Oracle: model checker verdict with a counterexample trace.
- Exit criterion: verdict recorded per candidate, or the unit marked not_applicable.
- Tool policy: only when --depth=deep; otherwise mark the unit not_applicable.
- Artifact: counterexample trace or proof note.

### S5 — Directed fuzzing and sanitizers

- Purpose: drive structured fuzzing and sanitizer builds at suspect entries.
- Oracle: sanitizer crash signature or fuzz crash input.
- Exit criterion: crash signature captured, or a clean corpus budget exhaustion recorded.
- Tool policy: only when --depth is dynamic or deep; build flags stay out of source.
- Artifact: crash signature plus minimized input.

### S6 — LLM hypothesis generation

- Purpose: generate suspects using IRIS/LLift/RepoAudit/Big Sleep-style patterns.
- Oracle: none yet — every output starts at E0.
- Exit criterion: hypotheses recorded with a falsification plan.
- Tool policy: read-only reasoning; no verdict may skip an oracle.
- Artifact: E0 candidates with needs_validation.

### S7 — Reduction and root cause

- Purpose: minimize (ddmin/Zeller) and name the root cause.
- Oracle: the minimized reproducer itself, deterministic on every run.
- Exit criterion: reproduction rate is 100% and the cause is isolated to one path.
- Tool policy: write only under .matrixx/bugs/<run-N>/reproducers/; never patch source.
- Artifact: reproducer file under .matrixx/bugs/<run-N>/reproducers/ plus root-cause
  statement.

### S8 — Fault localization (owner: trinity)

- Purpose: rank suspects with Tarantula/Ochiai-style spectra and slicing; trinity owns the
  slicing and the spectra (merovingian may assist hard reasoning).
- Oracle: suspiciousness ranking backed by the failing and passing runs.
- Exit criterion: the top-ranked suspect agrees with the S7 root cause.
- Tool policy: read-only instrumentation; no source edits.
- Artifact: ranked suspect list.

### S9 — Adversarial validation

- Purpose: fresh verifier pass where hunter is not verifier.
- Oracle: independent re-run of the finding's oracle and witness.
- Exit criterion: tier promotion only on reproduced evidence; otherwise rejected or deferred.
- Tool policy: read-only; promotion requires the witness, never seniority.
- Artifact: final findings with tier, status, and severity.

---

## TOOL MATRIX

| Language | Depth | Support | Notes |
|----------|-------|---------|-------|
| TypeScript / JavaScript | static, dynamic, deep | first-class | tsc, ast-grep, property tests |
| Python | static, dynamic, deep | first-class | mypy/ruff, pytest, hypothesis |
| Rust | static, dynamic, deep | first-class | cargo check/clippy, cargo test, miri/proptest |
| C / C++ | static, dynamic | best-effort | clang-tidy; sanitizers only with --depth dynamic or deep |
| Go | static | best-effort | go vet and go test; no dynamic sanitizer stage |
| anything else | any | out_of_scope | mark ledger units out_of_scope, never silent |
| Optional external analyzers | static | detect-and-degrade | semgrep, codeql, infer for TS/JS, Python, Java; optional |
| Rust bounded verification | deep | optional | Kani, miri |
| Mutation testing | deep | optional | Stryker (TS/JS), mutmut (Python); only with --depth=deep |

Optional tooling never fails the run. Semgrep, CodeQL, and Infer (TS/JS, Python, Java), Kani
and miri for bounded Rust verification, and Stryker/mutmut for mutation testing (only with
--depth=deep) are all detect-and-degrade: when one is missing, its unit becomes blocked with
exactly one install hint, never a silent skip.

---

## SECURITY DELEGATION

Security-class findings (injection, authz, secrets, crypto, supply chain) are delegated to the
security-audit skill and the security-* skills. Record the pointer in the finding's cross_ref
field only: do NOT start a security-audit run and do NOT write .matrixx/audits/. Never
reimplement the security workflow here, and never double-report severity.

---

## AGENT ROSTER

- S0 framing and oracle inventory → oracle.
- S1/S2 mining and slices → trinity.
- S3/S7 oracle and reproducer authoring
  (all artifacts under .matrixx/bugs/<run-N>/reproducers/) → mouse-source.
- S6 hypothesis and S9 adversarial reasoning → merovingian.
- S8 fault localization and slicing → trinity (merovingian may assist hard reasoning).
- Security-class delegation → sentinel plus security-audit (cross_ref only; no audit run,
  no .matrixx/audits/ writes).

---

## TARGET SAFETY — hard rules

1. --target must resolve inside the project root. If it does not, hard-error with exit 2 and
   write nothing.
2. Never read or copy secret material: skip .env*, *.pem, *.key, id_*, credential stores, and
   any file the user marks excluded. Never print or persist secret values in any artifact field.
3. --depth=dynamic or deep builds and executes project code (S4/S5 and the test runner). Only
   the current checkout, under the user's trust, may be built or executed. For a third-party or
   untrusted --target, S5 is blocked and recorded as such — never silently skipped.

---

## HARD RULES

- Never assign a severity to an E0 finding.
- Never exceed medium severity at E1.
- Never promote a tier without an oracle witness.
- Never mutate source, never rename symbols, never apply AST rewrites.
- Never publish or install dependencies (npm/bun/yarn publish, npm install, bun add, pip install, cargo install).
- Missing tool means blocked plus one install hint, never a silent skip.
- Hunter and verifier are different passes; self-approval is not validation.

---

## EVIDENCE REQUIREMENTS

Report each finding with its oracle and witness, then summarize the run:

- Run directory: .matrixx/bugs/<run-N>/ (metadata, ledger, findings, reproducers/).
- Tier counts: E0 / E1 / E2 / E3 totals for the run.
- Per finding: fingerprint, bug_class, cwe (canonical CWE-<number> form; a --class=cwe-N
  filter is normalized on write), stage, tier, status, oracle, witness, root_cause,
  remediation, and reproducer path when tier is E2 (optional at E3).
- Exit code: 0 clean, 1 findings, 2 invalid usage.
`,
}
