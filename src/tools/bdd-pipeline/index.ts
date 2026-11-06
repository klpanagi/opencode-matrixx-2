/** bdd-pipeline barrel: explicit named re-exports of local modules only. */
export {
  type AnalysisReportInput,
  buildAnalysisReport,
} from "./analysis-report"
export {
  buildAmbiguitiesSection,
  buildAnnotationsSection,
  buildAssumptionsSection,
  buildBackendMappingSection,
  buildFilesGeneratedSection,
  buildFrontendMappingSection,
  buildTestCoverageSection,
  stageStatusBadge,
} from "./analysis-report-sections"
export {
  BDD_PIPELINE_DESCRIPTION,
  BDD_PIPELINE_TOOL_NAME,
  PIPELINE_REQUIRED_OUTPUTS,
  PIPELINE_STAGES,
} from "./constants"
export {
  expandGlob,
  isFeaturePath,
  listFeatureFilesInDir,
  looksLikeGlob,
  resolveFeaturePaths,
} from "./feature-resolver"
export {
  runBddPipeline,
} from "./pipeline-runner"
export {
  type SpawnSubagentOptions,
  spawnStageSubagent,
} from "./subagent-runner"
export {
  createBddPipelineTool,
} from "./tools"
export type {
  BddPipelineArgs,
  BddPipelineContext,
  BddPipelineDeps,
  BddPipelineResult,
  BddPipelineStageName,
  BddPipelineStageResult,
  BddPipelineStageStatus,
  BddPipelineStatus,
  CreateContractResult,
  EnrichContractResult,
  GateResult,
  ParseFeatureResult,
} from "./types"
