import { MAX_PLAN_FILE_BYTES, measurePlanBytes } from "../../features/mission-state/constants"
import { PLAN_ERROR_CODES, planSizeExceededFields, planTrimRequiredFields } from "./error-codes"

/**
 * The plan write path's cap guard — the ONLY place a write is measured against
 * the cap. It performs no write of its own: a refusal leaves the applied bytes
 * in place and the caller owns the single rollback.
 *
 * `grep -rn "MAX_PLAN_FILE_BYTES" src/tools/plan/plan-update.ts` shows the hashline
 * path and the section-scoped path both arrive here as the same `appliedContent`:
 * a section-scoped edit is resolved to anchors and then written by the same
 * executor. One guard, one rollback, no second copy to drift.
 */

/** `keep` — the applied content is under the cap and must be persisted. */
export interface PlanCapKept {
  kind: "keep"
  bytes: number
}

/** `rolled-back` — over the cap: the original bytes are restored and this is the payload. */
export interface PlanCapExceeded {
  kind: "rolled-back"
  bytes: number
  payload: string
}

export type PlanCapVerdict = PlanCapKept | PlanCapExceeded

export const TRIM_REQUIRED_AFTER_CONSECUTIVE_REFUSALS = 2

const consecutiveSizeRefusals = new Map<string, number>()

export function resetPlanWriteGuardForTesting(): void {
  consecutiveSizeRefusals.clear()
}

/**
 * Runs between "the edit is on disk" and "the cap is enforced" so a fault in
 * that window can be injected. Production passes nothing; the parameter exists
 * so the window is reachable from a test rather than only from a real crash.
 */
export type PostApplyHook = () => void

/**
 * Measure `appliedContent` with the single byte ruler and report a refusal
 * when it is over the cap.
 *
 * This function never writes. It used to restore `originalContent` here, but it
 * runs in the same window where the caller is about to persist its own bytes:
 * rewriting identical content could clobber a concurrent good write. The caller
 * restores the pre-edit bytes on a refusal instead.
 */
export function enforcePlanCap(resolved: string, originalContent: string, appliedContent: string, cap: number = MAX_PLAN_FILE_BYTES): PlanCapVerdict {
  const bytes = measurePlanBytes(appliedContent)
  const originalBytes = measurePlanBytes(originalContent)
  if (bytes <= cap) {
    consecutiveSizeRefusals.delete(resolved)
    return { kind: "keep", bytes }
  }
  if (bytes < originalBytes) {
    consecutiveSizeRefusals.delete(resolved)
    return { kind: "keep", bytes }
  }
  const count = (consecutiveSizeRefusals.get(resolved) ?? 0) + 1
  consecutiveSizeRefusals.set(resolved, count)
  if (count > TRIM_REQUIRED_AFTER_CONSECUTIVE_REFUSALS) {
    const payload = JSON.stringify({
      error: PLAN_ERROR_CODES.trimRequired,
      ...planTrimRequiredFields(bytes, originalBytes, cap),
      filePath: resolved,
    })
    return { kind: "rolled-back", bytes, payload }
  }
  const payload = JSON.stringify({
    error: PLAN_ERROR_CODES.sizeExceeded,
    ...planSizeExceededFields(bytes, cap),
    filePath: resolved,
  })
  return { kind: "rolled-back", bytes, payload }
}
