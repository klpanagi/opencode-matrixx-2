import type { BuiltinSkill } from "../types"

const SYSTEMATIC_DEBUGGING_SKILL_NAME = "systematic-debugging"

const SYSTEMATIC_DEBUGGING_SKILL_DESCRIPTION =
  "Use when debugging failures, investigating flaky tests, or fixing regressions — root-cause-first debugging with a reproduce-isolate-hypothesize-verify gate and delete-code-first corollary. Related: tdd-enforcer, review-work."

export const systematicDebuggingSkill: BuiltinSkill = {
  name: SYSTEMATIC_DEBUGGING_SKILL_NAME,
  description: SYSTEMATIC_DEBUGGING_SKILL_DESCRIPTION,
  template: `# Systematic Debugging — Phase-1 Root-Cause Gate

## THE RULE

No fix without a proven root cause. Reproduction comes first, the fix comes last.

| Situation | Required First Action |
|-----------|----------------------|
| Bug report / failure | REPRODUCE it with a failing test before touching source |
| Flaky test | ISOLATE the nondeterminism before changing assertions |
| Regression | HYPOTHESIZE the breaking change, bisect to confirm |
| Any fix | VERIFY the root cause against evidence before writing the fix |

**Guessing is not debugging.** A fix applied without a proven root cause is a new bug waiting to surface.

---

## PHASE-1 ROOT-CAUSE GATE (MANDATORY, IN ORDER)

No phase may be skipped. Each phase has an exit criterion; do not advance until it is met.

### 1. REPRODUCE — prove the failure exists

Write the smallest failing test (or script) that exhibits the bug deterministically.

- The failure must describe the bug, not a compile error or environment issue.
- If you cannot reproduce it, you do not understand it — stop and gather more evidence.
- This failing test is the RED phase of RED-GREEN-REFACTOR (see software-dev BUILD).

**Exit criterion:** a failing test whose output names the defect.

### 2. ISOLATE — narrow the blast radius

Bisect the system until the fault is confined to one module, one function, one code path.

- Halve the suspect surface on each step: disable half the inputs, stub half the dependencies.
- Check inputs at every boundary — most "logic bugs" are wrong assumptions about what arrives.
- Record what you ruled out, not just what you suspect.

**Exit criterion:** one minimal trigger that reproduces the failure every time.

### 3. HYPOTHESIZE — state one cause, predict one outcome

Write down exactly ONE candidate root cause and the single observation that would falsify it.

- One hypothesis at a time. Two simultaneous hypotheses means zero conclusions.
- Each hypothesis must make a falsifiable prediction ("if X is the cause, then changing Y removes the failure").
- Rank by evidence, not by intuition: stack traces and bisected triggers outrank hunches.

**Exit criterion:** a written hypothesis with a falsifying test.

### 4. VERIFY — confirm the cause before fixing

Run the falsifying check. Only a confirmed hypothesis earns a fix.

- If the check refutes the hypothesis, return to HYPOTHESIZE — do not patch around it.
- If the check confirms it, the fix is now mechanical and minimal.
- After the fix (GREEN), the reproduction test becomes a permanent regression tombstone.

**Exit criterion:** evidence that the named cause produces the failure and its removal ends it.

---

## DELETE-CODE-FIRST COROLLARY

Before adding code to fix a confirmed root cause, ask: can I fix this by REMOVING code?

- Prefer removing code over adding code: dead branches, redundant guards, duplicated logic, speculative abstractions.
- Every line added is a line that can break; every line deleted is a line that cannot.
- If the root cause is unnecessary complexity, the fix is deletion — not another layer.
- When deletion is impossible, add the minimum code that makes the reproduction test pass (GREEN), then refactor.

**Order of preference:** delete the faulty code → simplify the surrounding code → add minimal code.

---

## TEST PLACEMENT — SOURCE OF TRUTH

This section resolves the stale co-located wording still present in older skill prose: the **tests/ mirror is the source of truth** for test placement.

- Source file \`src/foo/bar.ts\` → test file \`tests/foo/bar.test.ts\` (mirror the \`src/\` path under \`tests/\`).
- CI discovers tests via \`find tests script -name '*.test.ts'\` — see \`script/run-ci.sh\` remaining-tests step.
- \`src/**/*.test.ts\` files are CI-orphaned: the discovery glob never looks under \`src/\`, so co-located tests never run in CI.
- Mock-heavy tests (those using \`mock.module()\`) run isolated, one process per entry — single source: \`script/mock-heavy-list.txt\`. When adding a new \`mock.module()\` test, add it to that list.
- Verify the full picture locally with \`bash script/run-ci.sh\`.
- NEVER write \`src/\` co-located tests — always place tests under \`tests/\` mirroring the \`src/\` path.

---

## ALIGNMENT WITH software-dev BUILD (NO CONTRADICTION)

This skill is the debugging front-end to the software-dev BUILD phase, not an alternative to it:

- REPRODUCE here **is** the RED step of RED-GREEN-REFACTOR: a failing test written before the fix.
- The fix step here **is** the GREEN step: minimum code that makes the reproduction pass, no more.
- Post-fix cleanup follows REFACTOR with the suite green throughout.
- Phase-1 (this gate) precedes BUILD work: root cause proven first, then BUILD proceeds on confirmed ground.

Wherever this skill and software-dev BUILD overlap, RED-GREEN-REFACTOR governs.

---

## ANTI-PATTERNS (AUTOMATIC FAILURE)

| Anti-Pattern | Why It's Wrong | Correct Action |
|-------------|----------------|----------------|
| Fix without reproducing | You cannot prove the fix fixed anything | REPRODUCE first — failing test before source change |
| Multiple simultaneous hypotheses | No observation can confirm or refute anything | One hypothesis, one falsifying check |
| Patching symptoms | The root cause remains and will resurface | Complete ISOLATE → HYPOTHESIZE → VERIFY |
| Adding code when deletion fixes it | More code means more failure surface | Apply the delete-code-first corollary |
| Skipping VERIFY under time pressure | Pressure is when verification matters most | The gate is binary — no bypass thoughts |
| Deleting or skipping the reproduction test | You lose the regression tombstone | Keep it in the suite forever |

---

## EVIDENCE REQUIREMENTS

Report debugging work as:

\`\`\`
REPRODUCE — failing test: tests/foo/bar.test.ts ("does X when Y")
ISOLATE — minimal trigger: {one-line trigger}
HYPOTHESIZE — cause: {one sentence} / falsifier: {check}
VERIFY — {confirmed/refuted} via {evidence}
FIX — {deleted N lines | added minimal change}
✅ bun test — N passed, 0 failed
✅ bun run typecheck — no errors
\`\`\`

---

## HARD RULES (NO EXCEPTIONS)

\`\`\`
NEVER fix a bug you have not reproduced with a failing test
NEVER advance past a gate phase whose exit criterion is unmet
NEVER hold two hypotheses at once — falsify one, then move on
NEVER add code when deleting code resolves the root cause
NEVER place tests beside source — tests/ mirror only
\`\`\`
`,
}
