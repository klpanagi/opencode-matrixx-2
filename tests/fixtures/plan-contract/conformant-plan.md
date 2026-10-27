# Conformant Plan Fixture

> Minimal but complete Oracle-shaped plan: 10 canonical H2 sections in order and
> exactly one numbered task carrying all 9 required bold subfields.

## TL;DR

A short summary of the plan.

## Context

Everything the executor needs to understand the work.

## Work Objectives

What we intend to achieve.

### Definition of Done

- [ ] Feature implemented
- [ ] Tests pass

## Global Constraints

Plan-wide rules that hold for every task.

## Verification Strategy (MANDATORY)

Verification is performed by running the test suite.

## Execution Strategy

A single sequential wave.

## Review Focus

What the per-task gate and final review must verify.

## TODOs

- [ ] 1. Implement the feature

  **What to do**:
  - Write the implementation.
  - Cover the behavior with tests.

  **Must NOT do**:
  - Skip the tests.

  **Recommended Agent Profile**:
  - **Category**: `source`

  **Parallelization**:
  - **Can Run In Parallel**: NO

  **References** (CRITICAL - Be Exhaustive):
  - `src/example.ts:1-10` - the pattern to follow.

  **Consumes**:
  - Upstream inputs this task needs.
  - Source task for each input.

  **Produces**:
  - Downstream outputs this task hands off.
  - Consumer task for each output.

  **Acceptance Criteria**:
  - `bun test` → PASS

  **Agent-Executed QA Scenarios (MANDATORY — per-scenario, ultra-detailed):**

  ```
  Scenario: The feature works
    Tool: Bash
    Steps:
      1. Run: bun test
    Expected Result: PASS
  ```

## Commit Strategy

One atomic commit.

## Success Criteria

- [ ] All tests pass
- [ ] No lint errors
