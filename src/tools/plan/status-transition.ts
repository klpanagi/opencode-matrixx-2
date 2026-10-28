import { isPlanStatusTransitionAllowed, parsePlanFrontMatter } from "../../features/plan-contract"
import { PLAN_ERROR_CODES, type PlanErrorCode } from "./error-codes"

/**
 * Explicit human override for a backward plan-status jump.
 *
 * SINGLE definition site for the force-completion contract: Tasks 2 and 3
 * import this type rather than redeclaring it. Structurally identical to
 * `PlanStatusTransitionOptions` in `plan-contract/schema.ts`, so it passes
 * straight through to `isPlanStatusTransitionAllowed`.
 */
export interface ForceCompletionOptions {
  /** When true, a backward jump is honored instead of rejected. */
  forceCompletion?: boolean
}

/** Intended plan-status change extracted from a proposed edit. */
export interface PlanStatusTransition {
  /** Authoritative status before the edit. */
  from: string
  /** Authoritative status after the edit. */
  to: string
}

/** Verdict of `adjudicate`: allow carries no payload, reject names the code. */
export type StatusAdjudication =
  | { allowed: true }
  | { allowed: false; error: PlanErrorCode; from: string; to: string }

/**
 * Extract the intended plan-status transition between two plan contents.
 *
 * Parses the leading front-matter block of each side (body text is never
 * scanned, so status words in prose are ignored) and returns the before/after
 * pair when the status differs. Returns null when there is no transition:
 * identical statuses, or either side missing/unparseable front-matter.
 */
export function extractStatusEdit(currentContent: string, nextContent: string): PlanStatusTransition | null {
  const before = parsePlanFrontMatter(currentContent)
  const after = parsePlanFrontMatter(nextContent)
  if (before === null || after === null) return null
  if (before.status === after.status) return null
  return { from: before.status, to: after.status }
}

/**
 * Allow or reject an extracted plan-status transition.
 *
 * A null transition (no status change) always allows. Otherwise the verdict
 * delegates to `isPlanStatusTransitionAllowed`: forward or same-status jumps
 * pass, backward jumps reject with `status_transition_rejected` unless
 * `{ forceCompletion: true }` is supplied.
 */
export function adjudicate(
  transition: PlanStatusTransition | null,
  options?: ForceCompletionOptions,
): StatusAdjudication {
  if (transition === null) return { allowed: true }
  if (isPlanStatusTransitionAllowed(transition.from, transition.to, options)) {
    return { allowed: true }
  }
  return {
    allowed: false,
    error: PLAN_ERROR_CODES.statusTransitionRejected,
    from: transition.from,
    to: transition.to,
  }
}
