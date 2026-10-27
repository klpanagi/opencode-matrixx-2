import type { BuiltinSkill } from "../types"

const SOFTWARE_DEV_SKILL_NAME = "software-dev"

const SOFTWARE_DEV_SKILL_DESCRIPTION =
  "Use when building new features, implementing significant changes, or running a structured development workflow — coordinates specialized roles through build phases with entry/exit criteria. Related: tdd-enforcer, quality-gate, review-work."

export const softwareDevSkill: BuiltinSkill = {
  name: SOFTWARE_DEV_SKILL_NAME,
  description: SOFTWARE_DEV_SKILL_DESCRIPTION,
  template: `# Software Development Pipeline — Structured Team Orchestration

## OVERVIEW

This skill defines a 6-phase software development pipeline with specialized roles. Each phase has entry/exit criteria. No phase can be skipped without justification.

**Use this skill for:**
- New features (3+ files)
- Significant refactors
- Any work benefiting from structured development

**Do NOT use for:**
- Trivial fixes (1-2 lines)
- Documentation-only changes
- Exploration tasks

---

## TEAM ROLES

| Role | Delegate To | Skills | Purpose |
|------|-------------|--------|---------|
| Architect | \`subagent_type="oracle"\` | — | Design, architecture decisions |
| Developer | \`category="source"\` | git-master, tdd-enforcer | Implementation + tests |
| Quality Evaluator | \`category="red-pill"\` | quality-gate, review-work | Lint, typecheck, review |
| Security Expert | \`subagent_type="sentinel"\` | security-core, security-sast, security-api, security-dependencies | Security audit |

---

## PIPELINE

| Phase | Skip? | Role | Exit Criteria |
|-------|-------|------|---------------|
| 1. PLAN | Small tasks | Architect | Approach defined, files listed |
| 2. BUILD | Never | Developer | Code written, tests pass |
| 3. VERIFY | Never | Quality | Lint/typecheck/test/build pass |
| 4. REVIEW | Small tasks | Quality (6-agent) | All reviewers PASS |
| 5. SECURE | Small + non-security | Security | No CRITICAL/HIGH findings |
| 6. SHIP | Never | Developer | Commits + PR created |

**Task Size Rules:**
- **Small (1-2 files):** BUILD → VERIFY → SHIP only
- **Medium (3-10 files):** PLAN → BUILD → VERIFY → REVIEW → SHIP
- **Large (10+ files):** ALL 6 PHASES
- **Security-related (any size):** Always include SECURE

---

## PHASE 1: PLAN

Fire architecture planning:

\`\`\`
task(
  subagent_type="oracle",
  load_skills=[],
  run_in_background=true,
  description="Plan implementation approach",
  prompt="Plan implementation for: {REQUEST}\\n\\nContext: {CODEBASE_CONTEXT}\\n\\nDeliver: approach, file list, edge cases, dependency order.")
\`\`\`

**Exit criteria:**
- [ ] Implementation approach defined
- [ ] File list with responsibilities
- [ ] Edge cases documented

---

## PHASE 2: BUILD (TDD)

Worktree-first: create/use an isolated worktree before implementing (\`git worktree add ../<feature> -b <feature>\` — match git-master conventions). Run all BUILD + VERIFY work inside the worktree; never contaminate the main worktree.

For each file in dependency order:

\`\`\`
task(
  category="source",
  load_skills=["git-master", "tdd-enforcer"],
  run_in_background=true,
  description="Implement {FEATURE}",
  prompt="Implement from plan:\\n{PLAN}\\n\\nFile: {PATH}\\n\\nFollow tdd-enforcer: write test FIRST (RED), then minimum code (GREEN), then refactor. Run bun test after each change.")
\`\`\`

**Exit criteria:**
- [ ] All code written
- [ ] Tests written BEFORE implementation
- [ ] \`bun test\` — 0 failures

---

## PHASE 3: VERIFY

Run verification suite:

\`\`\`bash
bun run lint && bun run typecheck && bun test && bun run build
\`\`\`

Report evidence:
\`\`\`
✅ bun run lint — 0 issues
✅ bun run typecheck — no errors
✅ bun test — N passed, 0 failed
✅ bun run build — success
\`\`\`

If ANY fails → fix → re-run ALL.

**Exit criteria:**
- [ ] All 4 checks pass

---

## PHASE 4: REVIEW

Fire 6-agent parallel review:

\`\`\`
task(
  category="red-pill",
  load_skills=["quality-gate", "review-work"],
  run_in_background=true,
  description="Review implementation",
  prompt="Review completed implementation using review-work skill.\\n\\nGoal: {REQUEST}\\nFiles: {CHANGED_FILES}\\nDiff: {DIFF}")
\`\`\`

**Exit criteria:**
- [ ] All 6 reviewers PASS
- [ ] No CRITICAL/MAJOR blocking issues

---

## PHASE 5: SECURE

Fire security audit:

\`\`\`
task(
  subagent_type="sentinel",
  load_skills=["security-core", "security-sast", "security-api", "security-dependencies"],
  run_in_background=true,
  description="Security audit",
  prompt="Security audit on:\\n{CHANGED_FILES}\\n\\nDiff:\\n{DIFF}\\n\\nCheck: input validation, auth, secrets, injection, dependencies.")
\`\`\`

**Exit criteria:**
- [ ] No CRITICAL findings
- [ ] No HIGH findings

---

## PHASE 6: SHIP

\`\`\`
task(
  category="bullet-time",
  load_skills=["git-master"],
  run_in_background=false,
  description="Create commits and PR",
  prompt="Create atomic commits for implementation.\\n\\nFiles: {CHANGED_FILES}\\n\\nFollow git-master conventions. Target dev branch.")
\`\`\`

**Exit criteria:**
- [ ] Clean atomic commits
- [ ] PR targeting dev branch (dev, never master)
- [ ] CI passes
- [ ] env-detect: worktree vs in-place recorded (\`git worktree list\`)
- [ ] merge-verify: checks green before merge (lint + typecheck + test + build pass)
- [ ] cleanup: worktree removed after merge (\`git worktree remove\` + \`git worktree prune\`)
- [ ] Merge commit ONLY — never squash (squash merge is disabled)

---

## PIPELINE STATUS

Report after each phase:

\`\`\`
Pipeline Status:
  ✅ PLAN — Complete
  ✅ BUILD — Complete (N tests pass)
  ✅ VERIFY — Complete (all checks pass)
  🔄 REVIEW — In progress...
  ⬜ SECURE — Pending
  ⬜ SHIP — Pending
\`\`\`

If phase fails → STOP → fix → re-run that phase.

---

## TASK INTERFACES

Every task declares its interface contract with two REQUIRED-task-subfield labels. Wave 1 is guidance only — no validator enforcement; enforcement lands in Wave 2.

Labels are forward-compatible: Consumes / Produces will promote to grammar in Task 6 with these exact labels, aligned with REQUIRED_TASK_SUBFIELDS voice.

- **Consumes**: upstream inputs this task needs (files, APIs, types, decisions, prior task outputs). List each input with its source task.
- **Produces**: downstream outputs this task hands off (files, APIs, contracts, evidence). List each output with its consumer task.

Declare interfaces in dependency order — Consumes before Produces:

\`\`\`
Task 2 interface contract:
  Consumes: Task 1 → src/auth/schema.ts:LoginSchema (request shape)
  Produces: Task 3 ← src/auth/login.ts:login() (JWT session token)
\`\`\`

**Exit criteria:**
- [ ] Every task lists Consumes (inputs + source task)
- [ ] Every task lists Produces (outputs + consumer task)
- [ ] No task Produces what no downstream task Consumes

---

## PROGRESS LEDGER

Maintain a live progress ledger at \`.matrixx/evidence/{plan}/progress.md\` for every medium+ task. The ledger hooks into the BUILD and SHIP phases — it records phase completions, evidence links, and decisions. It adds no new pipeline phases.

- The ledger path inherits gitignore from the \`.matrixx/\` entry in \`.gitignore\` — ledger content is gitignored and never leaks into VCS.
- Ledger writes go through plan_*/task_* tools only (plan_update for plan checkboxes, task_update/task_create for task state). Never use bash heredoc or shell-redirect writes for ledger files.
- Raw bash mutation of \`.matrixx/plans/*.md\` and \`.matrixx/tasks/T-*.json\` is blocked by task-edit-guard — generic Write/Edit to plans is blocked the same way, so the ledger stays tool-written.

Ledger entry shape:

\`\`\`
## {phase} — {date}
- Status: done | in-progress | blocked
- Evidence: {test / lint / typecheck output}
- Decisions: {rulings recorded}
- Next: {consumer task}
\`\`\`

**Exit criteria:**
- [ ] Ledger created at .matrixx/evidence/{plan}/progress.md before BUILD ends
- [ ] Every phase completion appended via plan_*/task_* tools
- [ ] No shell-redirect writes to the ledger file

---

## RULINGS NOT STALLS

When blocked, record a ruling in the ledger and proceed — never stall silently. Each stop condition below names the ruling to record and the proceed action:

- Stop condition 1: ambiguous requirement with two plausible readings.
  - Ruling to record: chosen reading + why, logged in the ledger.
  - Proceed: implement the chosen reading; flag the alternative in REVIEW.
- Stop condition 2: missing upstream input from a task that is not yet complete.
  - Ruling to record: assumed input shape + source task, logged in the ledger.
  - Proceed: build against the assumption; reconcile when the upstream task lands.
- Stop condition 3: tool or environment failure blocking verification (flaky infra, unavailable service).
  - Ruling to record: failure signature + skipped check, logged in the ledger.
  - Proceed: continue with remaining checks; re-run the skipped check in VERIFY.
- Stop condition 4: conflicting guidance between plan text and skill prose.
  - Ruling to record: which source won + why, logged in the ledger.
  - Proceed: follow the winning source; note the conflict in the SHIP summary.

**Exit criteria:**
- [ ] Every stall risk matched to one of the 4 stop conditions
- [ ] Ruling to record logged in the ledger before proceeding
- [ ] Proceed action executed — never a silent stall

---

## WORKTREE-FIRST

Worktree-first: BUILD runs in an isolated worktree, SHIP merges from it. Never build directly in the main worktree when a worktree can isolate the change.

- Create/use: \`git worktree add ../<feature> -b <feature>\` (or \`opencode worktree_create\` where available) — match git-master conventions. Run BUILD + VERIFY inside the worktree.
- env-detect: detect worktree vs in-place before SHIP (\`git worktree list\` — worktree vs in-place determines merge + cleanup path).
- merge-verify: checks green before merge — lint + typecheck + test + build all pass before merge, PR targets dev.
- cleanup: remove worktree after merge (\`git worktree remove ../<feature>\` then \`git worktree prune\`).

**Exit criteria:**
- [ ] BUILD ran in a worktree (\`git worktree add\` used) or in-place justified
- [ ] env-detect recorded (worktree vs in-place)
- [ ] merge-verify: checks green before merge
- [ ] cleanup: worktree removed after merge

Repo law: PR targeting dev — dev, never master. Merge commit ONLY, never squash — squash merge is disabled at repo level.

---

## ANTI-PATTERNS

| Anti-Pattern | Correct Action |
|-------------|----------------|
| Skip PLAN for large tasks | Plan first — you'll miss edge cases |
| Skip TDD in BUILD | Write test FIRST, always |
| Skip VERIFY | Run full suite before proceeding |
| Skip REVIEW for medium+ | Review catches quality issues |
| Skip SECURE for auth work | Security audit required |
| Proceed after phase failure | Fix first, then continue |
| Report done without evidence | Show verification output |
`,
}
