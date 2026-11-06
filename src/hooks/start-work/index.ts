/** start-work barrel: explicit named re-exports of local modules only. */
export {
  ARCHIVED_PLAN_SEGMENT,
  type ClassifiedPlans,
  type ClassifyPlansOptions,
  classifyPlans,
  collectCompletionMismatchWarnings,
  formatPlanAge,
  formatPlanListLine,
  getPlanAgeMs,
  getPlansStaleAfterMs,
  isArchivedPlan,
  isPlanStale,
  type PlanListTag,
  type PlanMismatchWarning,
} from "./plan-filter"
export {
  createStartWorkHook,
  HOOK_NAME,
} from "./start-work-hook"
