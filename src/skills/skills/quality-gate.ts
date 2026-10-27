import type { BuiltinSkill } from "../types"

const QUALITY_GATE_SKILL_NAME = "quality-gate"

const QUALITY_GATE_SKILL_DESCRIPTION =
  "Automated quality verification after code changes: lint (Biome), typecheck, test execution, build verification. Triggers: 'verify', 'quality', 'lint', 'check', 'validate', 'quality gate', 'run checks'."

export const qualityGateSkill: BuiltinSkill = {
  name: QUALITY_GATE_SKILL_NAME,
  description: QUALITY_GATE_SKILL_DESCRIPTION,
  template: `# Quality Gate — Mandatory Verification After Code Changes

## THE RULE

Every code change (write, edit, refactor) MUST be verified before marking complete.

**Formatting is applied by OpenCode's native formatter pipeline; the quality-gate hook itself runs no checks.** Lint warnings still appear in tool output when present. Address them.

But the hook only covers linting. YOU must run the full verification suite.

---

## VERIFICATION CHECKLIST (EVERY CODE CHANGE)

Run these in order. ALL must pass before marking task done.

### 1. Lint (automatic + manual)
\`\`\`bash
bun run lint          # Full codebase lint
bun run lint:fix      # Auto-fix what Biome can
\`\`\`
OpenCode's native formatter pipeline handles per-file formatting. Fix lint warnings as they appear.

### 2. Type Check
\`\`\`bash
bun run typecheck     # tsc --noEmit
\`\`\`
Must exit 0 with no errors. Never suppress with \`as any\` or \`@ts-ignore\`.

### 3. Tests
\`\`\`bash
bun test              # All tests must pass
\`\`\`
If you changed behavior, write/update tests FIRST (see tdd-enforcer skill).

### 4. Build
\`\`\`bash
bun run build         # ESM + declarations
\`\`\`
Must exit 0. Verify dist/index.js exists.

---

## EVIDENCE FORMAT

Report verification results as:
\`\`\`
✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun test — 42 passed, 0 failed (3.2s)
✅ bun run build — success
\`\`\`

If ANY step fails:
1. STOP. Do not report done.
2. Fix the failure.
3. Re-run ALL verification steps.
4. Report done only when ALL pass.

---

## HOOK BEHAVIOR

The quality-gate hook is a pure non-blocking check (D2):
- Formatting is owned by OpenCode's native formatter pipeline — no double-format
- Verification policy (not a running task): bun run lint / typecheck / test / build
- Never halts tool execution; never starts child processes or timers

Run \`bun run lint:fix\` to auto-fix, or address issues manually.
Fix these inline when possible. For bulk fixes, run \`bun run lint:fix\`.

---

## GATE FUNCTION (IDENTIFY-RUN-READ-VERIFY)

Run the verification checklist above as a 4-step gate. Every code change passes through all four steps in order.

### Step 1: IDENTIFY - scope what changed

List every file you touched via git diff --name-only and git status --short.
Verification scope = exactly those files plus their dependents.
Never verify a subset and claim the whole change is green.

### Step 2: RUN - execute the full check suite

Run all four checks in one pass, in checklist order:
bun run lint && bun run typecheck && bun test && bun run build
Do not stop at the first green - run everything before judging.

### Step 3: READ - read the output, do not skim it

Open the full output of each check. Confirm counts yourself:
- Lint: read every warning line, not just the summary count
- Typecheck: read every error location
- Tests: read failures AND the pass count (N passed, 0 failed)
- Build: read for export and declaration errors

A gate you did not read is a gate you did not run.

### Step 4: VERIFY - confirm all green with evidence

Report evidence using the exact phrases from the EVIDENCE FORMAT section
(matching the software-dev VERIFY phase wording):

✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun test — N passed, 0 failed
✅ bun run build — success

If ANY step fails: STOP. Do not report done. Fix the failure, then re-run
ALL four checks from Step 2 (RUN).

---

## RED FLAGS - STOP AND FIX BEFORE PROCEEDING

Any one of these invalidates the gate. Fix it, then restart at Step 2 (RUN).

| Red Flag | What It Looks Like | Fix |
|----------|-------------------|-----|
| Suppressed errors | Empty catch blocks, swallowed rejections, ts-ignore to silence a real error | Handle or propagate the error; remove the suppression |
| Skipped tests | .skip, .todo, commented-out assertions, tests excluded from the run | Un-skip or delete; every test in scope must run |
| as-any escapes | as any, as unknown as casts to silence the checker | Type properly; never suppress with as any |
| Unchecked warnings | Lint warnings acknowledged but left in place, build warnings ignored | Fix each warning or document why it is safe |

A gate with an open Red Flag is not green, no matter what the summary counts say.

---

## RATIONALIZATION GUARD

These thoughts mean the gate is being bypassed. If you catch yourself
thinking them, restart at Step 1 (IDENTIFY).

- "It is good enough" - Good enough is not verified. Run the gate.
- "Too small to break anything" - Small changes break things. Run the gate.
- "Tests would have caught it" - Only if you ran them and read the output.
- "I will verify after marking done" - Never trust - always verify first.
- "Partial green is fine" - Never report partial claims. ALL checks must pass.

No partial claims. No "lint passes, will check tests later".
The gate is binary: all green or not done.

---

## VCS-DIFF STEP - REVIEW BEFORE DONE

After all checks pass and before reporting done, review the diff:

- git diff (review every hunk you are about to claim)
- git diff --stat (confirm the file list matches IDENTIFY scope)

Confirm:
1. The diff contains only what you intended - no stray edits, no debug leftovers
2. The file list matches the IDENTIFY scope from Step 1
3. No secrets, tokens, or credentials in the diff

Only after the diff review passes do you report done.
This gate is prompt-only guidance for the agent - it adds no hooks and
blocks nothing automatically. Non-blocking by design.

---

## ANTI-PATTERNS

| Anti-Pattern | Why It's Wrong |
|-------------|----------------|
| Skip lint because "it's just style" | Lint catches real bugs (noUnusedVariables, noDoubleEquals) |
| Skip typecheck because "it compiled before" | Types change with every edit |
| Skip tests because "it's a small change" | Small changes break things |
| Skip build because "tests pass" | Build validates exports and declarations |
| Report done without running verification | Never trust — always verify |
`,
}
