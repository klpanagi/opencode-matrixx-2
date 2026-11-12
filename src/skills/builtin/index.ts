// NOTE: These barrel re-exports are for type-level access only.
// Runtime template loading is now lazy via createBuiltinSkills().
// Do NOT import individual skills for runtime template access.
// Use createBuiltinSkills() instead.


export { bddBackendSkill, bddContractSkill, bddFrontendSkill, bddTestsSkill } from "./bdd"
export { agentBrowserSkill, devBrowserSkill, dockerMasterSkill, documentReaderSkill, gitMasterSkill, matrixxSelfConfigSkill, playwrightCliSkill, playwrightSkill, pythonAsyncioSkill, qualityGateSkill, removeAiSlopsSkill, resilienceErrorTaxonomySkill, resilienceFailureHuntingSkill, reviewWorkSkill, rpResearchSkill, silentFailureDetectionSkill, softwareDevSkill, systematicDebuggingSkill, tddEnforcerSkill, telegramBotSkill } from "./core"
export { dslCodegenSkill, dslCompositionSkill, dslCoreSkill, dslGrammarSkill, dslMetamodelSkill, dslModelTransformationSkill, dslPyecoreAdvancedSkill, dslTestingSkill, dslTextxEcosystemSkill, dslToolingSkill, dslValidationSkill } from "./dsl"
export { frontendA11ySkill, frontendBuildToolingSkill, frontendPerfSkill, frontendStateDataSkill, frontendTestingSkill, frontendUiUxSkill, reactNextjsPatternsSkill, svelteSveltekitPatternsSkill } from "./frontend"
// Crypto / market-data domain skills
export { ccxtProWebsocketsSkill, ccxtRestSkill, cryptoMarketStructureSkill, dataQualityObservabilitySkill, grafanaDashboardsSkill, influxdbTimeseriesSkill, marketDataArchitectureSkill, marketDataBusSkill, marketDataRobustnessReviewSkill, timeSeriesFundamentalsSkill } from "./market-data"
export { SECURITY_AUDIT_SKILL_NAME, securityApiSkill, securityAuditSkill, securityCoreSkill, securityCryptoSkill, securityDastSkill, securityDependenciesSkill, securityInfraSkill, securityReviewSkill, securitySastSkill, securitySecretsSkill } from "./security"
export { zeromqAdvancedReqrepSkill, zeromqArchitectureSkill, zeromqCoreSkill, zeromqFrameworksSkill, zeromqPubsubSkill, zeromqReliabilitySkill, zeromqSocketsPatternsSkill } from "./zeromq"
