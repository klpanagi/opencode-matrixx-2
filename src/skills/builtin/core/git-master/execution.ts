export const executionSection = `## PHASE 4: Commit Strategy Decision

<strategy_decision>
### 4.1 For Each Commit Group, Decide:

\`\`\`
FIXUP if:
  - Change complements existing commit's intent
  - Same feature, fixing bugs or adding missing parts
  - Review feedback incorporation
  - Target commit exists in local history

NEW COMMIT if:
  - New feature or capability
  - Independent logical unit
  - Different issue/ticket
  - No suitable target commit exists
\`\`\`

### 4.2 History Rebuild Decision (Aggressive Option)

\`\`\`
CONSIDER RESET & REBUILD when:
  - History is messy (many small fixups already)
  - Commits are not atomic (mixed concerns)
  - Dependency order is wrong
  
RESET WORKFLOW:
  1. git reset --soft $(git merge-base HEAD main)
  2. All changes now staged
  3. Re-commit in proper atomic units
  4. Clean history from scratch
  
ONLY IF:
  - All commits are local (not pushed)
  - User explicitly allows OR branch is clearly WIP
\`\`\`

### 4.3 Final Plan Summary

\`\`\`yaml
EXECUTION_PLAN:
  strategy: FIXUP_THEN_NEW | NEW_ONLY | RESET_REBUILD
  fixup_commits:
    - files: [...]
      target: <hash>
  new_commits:
    - files: [...]
      message: "..."
      level: N
  requires_force_push: true | false
\`\`\`
</strategy_decision>

---

## PHASE 5: Commit Execution

<execution>
### 5.1 Register TODO Items

Use task_create to register each commit as a trackable item:
\`\`\`
- [ ] Fixup: <description> -> <target-hash>
- [ ] New: <description>
- [ ] Rebase autosquash
- [ ] Final verification
\`\`\`

### 5.2 Fixup Commits (If Any)

\`\`\`bash
# Stage files for each fixup
git add <files>
git commit --fixup=<target-hash>

# Repeat for all fixups...

# Single autosquash rebase at the end
MERGE_BASE=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash $MERGE_BASE
\`\`\`

### 5.3 New Commits (After Fixups)

For each new commit group, in dependency order:

\`\`\`bash
# Stage files
git add <file1> <file2> ...

# Verify staging
git diff --staged --stat

# Commit with detected style
git commit -m "<message-matching-COMMIT_CONFIG>"

# Verify
git log -1 --oneline
\`\`\`

### 5.4 Commit Message Generation

**Based on COMMIT_CONFIG from Phase 1:**

\`\`\`
IF style == SEMANTIC AND language == KOREAN:
  -> "feat: 로그인 기능 추가"
  
IF style == SEMANTIC AND language == ENGLISH:
  -> "feat: add login feature"
  
IF style == PLAIN AND language == KOREAN:
  -> "로그인 기능 추가"
  
IF style == PLAIN AND language == ENGLISH:
  -> "Add login feature"
  
IF style == SHORT:
  -> "format" / "type fix" / "lint"
\`\`\`

**VALIDATION before each commit:**
1. Does message match detected style?
2. Does language match detected language?
3. Is it similar to examples from git log?

If ANY check fails -> REWRITE message.
\`\`\`
</execution>

---

## PHASE 6: Verification & Cleanup

<verification>
### 6.1 Post-Commit Verification

\`\`\`bash
# Check working directory clean
git status

# Review new history
git log --oneline $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master)..HEAD

# Verify each commit is atomic
# (mentally check: can each be reverted independently?)
\`\`\`

### 6.2 Force Push Decision

\`\`\`
IF fixup was used AND branch has upstream:
  -> Requires: git push --force-with-lease
  -> WARN user about force push implications
  
IF only new commits:
  -> Regular: git push
\`\`\`

### 6.3 Final Report

\`\`\`
COMMIT SUMMARY:
  Strategy: <what was done>
  Commits created: N
  Fixups merged: M
  
HISTORY:
  <hash1> <message1>
  <hash2> <message2>
  ...

NEXT STEPS:
  - git push [--force-with-lease]
  - Create PR if ready
\`\`\`
</verification>

---

## WORKTREE PROCEDURES

Isolated work via native worktrees. Never contaminate the main worktree — create/use a worktree per feature branch (matches review-work convention). Prefer native tools; CLI fallback only when native unavailable — single-path rule (native XOR CLI, never mixed).

- Create: \`worktree_create({ name: "<feature>" })\` — use returned absolute \`directory\`, then \`session_move({ directory })\` with move-back owner (CLI fallback \`git worktree add ../<feature> -b <feature>\` only).
- List / env-detect: \`worktree_list\` — detect worktree vs in-place before SHIP by matching returned directories; the result determines merge + cleanup path (CLI \`git worktree list\` fallback only).
- Remove / cleanup: \`worktree_remove({ directory: <absolute> })\` — remove worktree after merge, no prune; \`force\` only on user confirmation (CLI \`git worktree remove ../<feature>\` then \`git worktree prune\` fallback only).

Repo law: PR targeting dev — dev, never master. Merge commit ONLY, never squash — squash merge is disabled at repo level. This rule governs PR merges only; local history rewrite via interactive rebase / autosquash (\`--autosquash\`) remains a separate COMMIT-mode tool and never replaces the merge-commit rule.

---

## Quick Reference

### Style Detection Cheat Sheet

| If git log shows... | Use this style |
|---------------------|----------------|
| \`feat: xxx\`, \`fix: yyy\` | SEMANTIC |
| \`Add xxx\`, \`Fix yyy\`, \`xxx 추가\` | PLAIN |
| \`format\`, \`lint\`, \`typo\` | SHORT |
| Full sentences | SENTENCE |
| Mix of above | Use MAJORITY (not semantic by default) |

### Decision Tree

\`\`\`
Is this on main/master?
  YES -> NEW_COMMITS_ONLY, never rewrite
  NO -> Continue

Are all commits local (not pushed)?
  YES -> AGGRESSIVE_REWRITE allowed
  NO -> CAREFUL_REWRITE (warn on force push)

Does change complement existing commit?
  YES -> FIXUP to that commit
  NO -> NEW COMMIT

Is history messy?
  YES + all local -> Consider RESET_REBUILD
  NO -> Normal flow
\`\`\`

### Anti-Patterns (AUTOMATIC FAILURE)

1. **NEVER make one giant commit** - 3+ files MUST be 2+ commits
2. **NEVER default to semantic commits** - detect from git log first
3. **NEVER separate test from implementation** - same commit always
4. **NEVER group by file type** - group by feature/module
5. **NEVER rewrite pushed history** without explicit permission
6. **NEVER leave working directory dirty** - complete all changes
7. **NEVER skip JUSTIFICATION** - explain why files are grouped
8. **NEVER use vague grouping reasons** - "related to X" is NOT valid

---

## FINAL CHECK BEFORE EXECUTION (BLOCKING)

\`\`\`
STOP AND VERIFY - Do not proceed until ALL boxes checked:

[] File count check: N files -> at least ceil(N/3) commits?
  - 3 files -> min 1 commit
  - 5 files -> min 2 commits
  - 10 files -> min 4 commits
  - 20 files -> min 7 commits

[] Justification check: For each commit with 3+ files, did I write WHY?

[] Directory split check: Different directories -> different commits?

[] Test pairing check: Each test with its implementation?

[] Dependency order check: Foundations before dependents?
\`\`\`

**HARD STOP CONDITIONS:**
- Making 1 commit from 3+ files -> **WRONG. SPLIT.**
- Making 2 commits from 10+ files -> **WRONG. SPLIT MORE.**
- Can't justify file grouping in one sentence -> **WRONG. SPLIT.**
- Different directories in same commit (without justification) -> **WRONG. SPLIT.**

---
---

`
