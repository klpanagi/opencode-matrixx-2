/** dashboard-flux-validator barrel: explicit named re-exports of local modules only. */
export {
  DASHBOARD_EXTENSIONS,
  DASHBOARD_FLUX_VALIDATE_DESCRIPTION,
  IGNORED_DIRS,
  RULE_CATALOG,
} from "./constants"
export {
  createDashboardFluxValidatorTool,
} from "./tools"
export type {
  FluxFinding,
  FluxSeverity,
  FluxSummary,
  FluxValidationResult,
} from "./types"
export {
  validateDashboard,
} from "./validator"
