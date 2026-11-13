import type { BuiltinSkill } from "../../loader/types"

const QUALITY_GATE_SKILL_NAME = "quality-gate"

const QUALITY_GATE_SKILL_DESCRIPTION =
  "Use when verifying code quality after changes — lint (Biome), typecheck, test execution, and build verification with mandatory evidence. Related: tdd-enforcer, review-work, software-dev."

export const qualityGateSkill: BuiltinSkill = {
  name: QUALITY_GATE_SKILL_NAME,
  description: QUALITY_GATE_SKILL_DESCRIPTION,
  template: `# Quality Gate — Mandatory Verification After Code Changes

## THE RULE

Every code change (write, edit, refactor) MUST be verified before marking complete.

**The quality-gate hook is advisory: it performs no checks and blocks nothing.** Formatting is applied by OpenCode's native formatter pipeline. YOU must run the full verification suite below.

---

## GATE FUNCTION: IDENTIFY → RUN → READ → VERIFY

Run this single procedure for every code change. The quality-gate hook is advisory: it performs no checks and blocks nothing — YOU run the gate.

### Step 1: IDENTIFY — scope what changed

List every file you touched via \`git diff --name-only\` and \`git status --short\`.
Verification scope = exactly those files plus their dependents.
Never verify a subset and claim the whole change is green.

### Step 2: RUN — execute the full CI command

Run the full CI suite as the single gate:
\`\`\`bash
bun run test   # full CI: lint + typecheck + isolated tests + build
\`\`\`
This one command runs, in order:

1. Lint (Biome) — \`bun run lint\`
2. Typecheck (\`tsc --noEmit\`) — \`bun run typecheck\`
3. Isolated tests — the test runner
4. Build (ESM + declarations) — \`bun run build\`

While fixing you may rerun a single check (\`bun run lint\`, \`bun run lint:fix\`, \`bun run typecheck\`, \`bun run test\`, \`bun run build\`), but the gate itself is the full command. Formatting is handled by OpenCode's native formatter pipeline; fix lint warnings as they appear. Do not stop at the first green — run everything before judging.

### Step 3: READ — read the output, do not skim it

Open the full output of each check. Confirm counts yourself:
- Lint: read every warning line, not just the summary count
- Typecheck: read every error location
- Tests: read failures AND the pass count (N passed, 0 failed)
- Build: read for export and declaration errors

A gate you did not read is a gate you did not run.

### Step 4: VERIFY — confirm all green with evidence

Report evidence for each check:
\`\`\`
✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun run test — N passed, 0 failed
✅ bun run build — success
\`\`\`

If ANY check fails: STOP. Do not report done. Fix the failure, then re-run the whole gate from Step 2 (RUN).

**Exit criteria (all required):**
- [ ] All four checks pass in the full CI command
- [ ] Output read for every check
- [ ] No open Red Flag (see below)
- [ ] Diff reviewed before reporting done

---

## HOOK BEHAVIOR

The quality-gate hook is advisory only:
- It runs no checks and never halts tool execution
- Formatting is owned by OpenCode's native formatter pipeline — no double-format
- Verification is performed by YOU, using the gate above

Run \`bun run lint:fix\` to auto-fix, or address issues manually.

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
