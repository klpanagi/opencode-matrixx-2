import type { BrowserAutomationProvider } from "../config/schema"
import { createLazyTemplateSkill } from "./lazy-skill-helper"
import { bddBackendSkill } from "./skills/bdd/bdd-backend"
import { bddContractSkill } from "./skills/bdd/bdd-contract"
import { bddFrontendSkill } from "./skills/bdd/bdd-frontend"
import { bddTestsSkill } from "./skills/bdd/bdd-tests"
import { devBrowserSkill } from "./skills/core/dev-browser"
import { dockerMasterSkill } from "./skills/core/docker-master"
import { documentReaderSkill } from "./skills/core/document-reader"
import { gitMasterSkill } from "./skills/core/git-master"
import { matrixxSelfConfigSkill } from "./skills/core/matrixx-self-config"
import { agentBrowserSkill, playwrightSkill } from "./skills/core/playwright"
import { playwrightCliSkill } from "./skills/core/playwright-cli"
import { pythonAsyncioSkill } from "./skills/core/python-asyncio"
import { qualityGateSkill } from "./skills/core/quality-gate"
import { removeAiSlopsSkill } from "./skills/core/remove-ai-slops"
import { resilienceErrorTaxonomySkill } from "./skills/core/resilience-error-taxonomy"
import { resilienceFailureHuntingSkill } from "./skills/core/resilience-failure-hunting"
import { reviewWorkSkill } from "./skills/core/review-work"
import { silentFailureDetectionSkill } from "./skills/core/silent-failure-detection"
import { softwareDevSkill } from "./skills/core/software-dev"
import { systematicDebuggingSkill } from "./skills/core/systematic-debugging"
import { tddEnforcerSkill } from "./skills/core/tdd-enforcer"
import { telegramBotSkill } from "./skills/core/telegram-bot"
import { ulwResearchSkill } from "./skills/core/ulw-research"
import { dslCodegenSkill } from "./skills/dsl/dsl-codegen"
import { dslCompositionSkill } from "./skills/dsl/dsl-composition"
import { dslCoreSkill } from "./skills/dsl/dsl-core"
import { dslGrammarSkill } from "./skills/dsl/dsl-grammar"
import { dslMetamodelSkill } from "./skills/dsl/dsl-metamodel"
import { dslModelTransformationSkill } from "./skills/dsl/dsl-model-transformation"
import { dslPyecoreAdvancedSkill } from "./skills/dsl/dsl-pyecore-advanced"
import { dslTestingSkill } from "./skills/dsl/dsl-testing"
import { dslTextxEcosystemSkill } from "./skills/dsl/dsl-textx-ecosystem"
import { dslToolingSkill } from "./skills/dsl/dsl-tooling"
import { dslValidationSkill } from "./skills/dsl/dsl-validation"
import { frontendA11ySkill } from "./skills/frontend/frontend-a11y"
import { frontendBuildToolingSkill } from "./skills/frontend/frontend-build-tooling"
import { frontendPerfSkill } from "./skills/frontend/frontend-perf"
import { reactNextjsPatternsSkill } from "./skills/frontend/frontend-react-nextjs"
import { frontendStateDataSkill } from "./skills/frontend/frontend-state-data"
import { svelteSveltekitPatternsSkill } from "./skills/frontend/frontend-svelte-sveltekit"
import { frontendTestingSkill } from "./skills/frontend/frontend-testing"
import { frontendUiUxSkill } from "./skills/frontend/frontend-ui-ux"
import { ccxtProWebsocketsSkill } from "./skills/market-data/ccxt-pro-websockets"
import { ccxtRestSkill } from "./skills/market-data/ccxt-rest"
import { cryptoMarketStructureSkill } from "./skills/market-data/crypto-market-structure"
import { dataQualityObservabilitySkill } from "./skills/market-data/data-quality-observability"
import { grafanaDashboardsSkill } from "./skills/market-data/grafana-dashboards"
import { influxdbTimeseriesSkill } from "./skills/market-data/influxdb-timeseries"
import { marketDataArchitectureSkill } from "./skills/market-data/market-data-architecture"
import { marketDataBusSkill } from "./skills/market-data/market-data-bus"
import { marketDataRobustnessReviewSkill } from "./skills/market-data/market-data-robustness-review"
import { timeSeriesFundamentalsSkill } from "./skills/market-data/time-series-fundamentals"
import { securityApiSkill } from "./skills/security/security-api"
import { securityAuditSkill } from "./skills/security/security-audit"
import { securityCoreSkill } from "./skills/security/security-core"
import { securityCryptoSkill } from "./skills/security/security-crypto"
import { securityDastSkill } from "./skills/security/security-dast"
import { securityDependenciesSkill } from "./skills/security/security-dependencies"
import { securityInfraSkill } from "./skills/security/security-infra"
import { securityReviewSkill } from "./skills/security/security-review"
import { securitySastSkill } from "./skills/security/security-sast"
import { securitySecretsSkill } from "./skills/security/security-secrets"
import { zeromqAdvancedReqrepSkill } from "./skills/zeromq/zeromq-advanced-reqrep"
import { zeromqArchitectureSkill } from "./skills/zeromq/zeromq-architecture"
import { zeromqCoreSkill } from "./skills/zeromq/zeromq-core"
import { zeromqFrameworksSkill } from "./skills/zeromq/zeromq-frameworks"
import { zeromqPubsubSkill } from "./skills/zeromq/zeromq-pubsub"
import { zeromqReliabilitySkill } from "./skills/zeromq/zeromq-reliability"
import { zeromqSocketsPatternsSkill } from "./skills/zeromq/zeromq-sockets-patterns"
import type { BuiltinSkill } from "./types"

const BROWSER_SKILL_NAMES = new Set(["playwright", "agent-browser", "playwright-cli"])

/**
 * Static skill table: content dirs are data only, there is no require() seam.
 * Each entry is a factory returning the already-imported skill object;
 * template text still resolves through the lazy getter in
 * `createLazyTemplateSkill`, so construction stays allocation-only.
 */
const skillFactories: Record<string, () => BuiltinSkill> = {
  "playwright": () => playwrightSkill,
  "agent-browser": () => agentBrowserSkill,
  "playwright-cli": () => playwrightCliSkill,
  "frontend-ui-ux": () => frontendUiUxSkill,
  "docker-master": () => dockerMasterSkill,
  "git-master": () => gitMasterSkill,
  "dev-browser": () => devBrowserSkill,
  "dsl-core": () => dslCoreSkill,
  "dsl-grammar": () => dslGrammarSkill,
  "dsl-codegen": () => dslCodegenSkill,
  "dsl-metamodel": () => dslMetamodelSkill,
  "dsl-tooling": () => dslToolingSkill,
  "dsl-textx-ecosystem": () => dslTextxEcosystemSkill,
  "dsl-pyecore-advanced": () => dslPyecoreAdvancedSkill,
  "dsl-model-transformation": () => dslModelTransformationSkill,
  "dsl-testing": () => dslTestingSkill,
  "dsl-validation": () => dslValidationSkill,
  "dsl-composition": () => dslCompositionSkill,
  "frontend-a11y": () => frontendA11ySkill,
  "bdd-backend": () => bddBackendSkill,
  "bdd-contract": () => bddContractSkill,
  "bdd-frontend": () => bddFrontendSkill,
  "bdd-tests": () => bddTestsSkill,
  "frontend-build-tooling": () => frontendBuildToolingSkill,
  "frontend-perf": () => frontendPerfSkill,
  "frontend-state-data": () => frontendStateDataSkill,
  "frontend-testing": () => frontendTestingSkill,
  "react-nextjs-patterns": () => reactNextjsPatternsSkill,
  "svelte-sveltekit-patterns": () => svelteSveltekitPatternsSkill,
  "document-reader": () => documentReaderSkill,
  "security-core": () => securityCoreSkill,
  "security-secrets": () => securitySecretsSkill,
  "security-sast": () => securitySastSkill,
  "security-dast": () => securityDastSkill,
  "security-dependencies": () => securityDependenciesSkill,
  "security-api": () => securityApiSkill,
  "security-audit": () => securityAuditSkill,
  "security-crypto": () => securityCryptoSkill,
  "security-infra": () => securityInfraSkill,
  "security-review": () => securityReviewSkill,
  "tdd-enforcer": () => tddEnforcerSkill,
  "review-work": () => reviewWorkSkill,
  "quality-gate": () => qualityGateSkill,
  "software-dev": () => softwareDevSkill,
  "matrixx-self-config": () => matrixxSelfConfigSkill,
  "ulw-research": () => ulwResearchSkill,
  "remove-ai-slops": () => removeAiSlopsSkill,
  "zeromq-core": () => zeromqCoreSkill,
  "zeromq-sockets-patterns": () => zeromqSocketsPatternsSkill,
  "zeromq-advanced-reqrep": () => zeromqAdvancedReqrepSkill,
  "zeromq-reliability": () => zeromqReliabilitySkill,
  "zeromq-pubsub": () => zeromqPubsubSkill,
  "zeromq-architecture": () => zeromqArchitectureSkill,
  "zeromq-frameworks": () => zeromqFrameworksSkill,
  "python-asyncio": () => pythonAsyncioSkill,
  "ccxt-rest": () => ccxtRestSkill,
  "ccxt-pro-websockets": () => ccxtProWebsocketsSkill,
  "market-data-bus": () => marketDataBusSkill,
  "market-data-architecture": () => marketDataArchitectureSkill,
  "market-data-robustness-review": () => marketDataRobustnessReviewSkill,
  "crypto-market-structure": () => cryptoMarketStructureSkill,
  "time-series-fundamentals": () => timeSeriesFundamentalsSkill,
  "influxdb-timeseries": () => influxdbTimeseriesSkill,
  "grafana-dashboards": () => grafanaDashboardsSkill,
  "telegram-bot": () => telegramBotSkill,
  "resilience-error-taxonomy": () => resilienceErrorTaxonomySkill,
  "resilience-failure-hunting": () => resilienceFailureHuntingSkill,
  "silent-failure-detection": () => silentFailureDetectionSkill,
  "systematic-debugging": () => systematicDebuggingSkill,
  "data-quality-observability": () => dataQualityObservabilitySkill,
}

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills: rawDisabledSkills } = options
  const disabledSkills = rawDisabledSkills instanceof Set ? rawDisabledSkills : new Set(rawDisabledSkills ?? [])

  // Determine which browser skill to use (selected eagerly, others excluded)
  const browserSkillName = browserProvider === "agent-browser"
    ? "agent-browser"
    : browserProvider === "playwright-cli"
      ? "playwright-cli"
      : "playwright"

  // Browser skill resolved eagerly (small, always needed for filtering)
  const browserSkill = skillFactories[browserSkillName]()

  // All non-browser skills resolve through the lazy template wrapper
  const lazySkillNames = Object.keys(skillFactories).filter(
    (n) => n !== browserSkillName && !BROWSER_SKILL_NAMES.has(n),
  )
  const lazySkills = lazySkillNames.map((name) =>
    createLazyTemplateSkill(name, skillFactories[name]),
  )

  const allSkills = [browserSkill, ...lazySkills]

  if (!disabledSkills) {
    return allSkills
  }

  return allSkills.filter((skill) => !disabledSkills.has(skill.name))
}
