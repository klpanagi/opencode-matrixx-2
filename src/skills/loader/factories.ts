import type { BrowserAutomationProvider } from "../../config/schema"
import { bddBackendSkill } from "../builtin/bdd/bdd-backend"
import { bddContractSkill } from "../builtin/bdd/bdd-contract"
import { bddFrontendSkill } from "../builtin/bdd/bdd-frontend"
import { bddTestsSkill } from "../builtin/bdd/bdd-tests"
import { devBrowserSkill } from "../builtin/core/dev-browser"
import { dockerMasterSkill } from "../builtin/core/docker-master"
import { documentReaderSkill } from "../builtin/core/document-reader"
import { gitMasterSkill } from "../builtin/core/git-master"
import { matrixxSelfConfigSkill } from "../builtin/core/matrixx-self-config"
import { agentBrowserSkill, playwrightSkill } from "../builtin/core/playwright"
import { playwrightCliSkill } from "../builtin/core/playwright-cli"
import { pythonAsyncioSkill } from "../builtin/core/python-asyncio"
import { qualityGateSkill } from "../builtin/core/quality-gate"
import { removeAiSlopsSkill } from "../builtin/core/remove-ai-slops"
import { resilienceErrorTaxonomySkill } from "../builtin/core/resilience-error-taxonomy"
import { resilienceFailureHuntingSkill } from "../builtin/core/resilience-failure-hunting"
import { reviewWorkSkill } from "../builtin/core/review-work"
import { silentFailureDetectionSkill } from "../builtin/core/silent-failure-detection"
import { softwareDevSkill } from "../builtin/core/software-dev"
import { systematicDebuggingSkill } from "../builtin/core/systematic-debugging"
import { tddEnforcerSkill } from "../builtin/core/tdd-enforcer"
import { telegramBotSkill } from "../builtin/core/telegram-bot"
import { ulwResearchSkill } from "../builtin/core/ulw-research"
import { dslCodegenSkill } from "../builtin/dsl/dsl-codegen"
import { dslCompositionSkill } from "../builtin/dsl/dsl-composition"
import { dslCoreSkill } from "../builtin/dsl/dsl-core"
import { dslGrammarSkill } from "../builtin/dsl/dsl-grammar"
import { dslMetamodelSkill } from "../builtin/dsl/dsl-metamodel"
import { dslModelTransformationSkill } from "../builtin/dsl/dsl-model-transformation"
import { dslPyecoreAdvancedSkill } from "../builtin/dsl/dsl-pyecore-advanced"
import { dslTestingSkill } from "../builtin/dsl/dsl-testing"
import { dslTextxEcosystemSkill } from "../builtin/dsl/dsl-textx-ecosystem"
import { dslToolingSkill } from "../builtin/dsl/dsl-tooling"
import { dslValidationSkill } from "../builtin/dsl/dsl-validation"
import { frontendA11ySkill } from "../builtin/frontend/frontend-a11y"
import { frontendBuildToolingSkill } from "../builtin/frontend/frontend-build-tooling"
import { frontendPerfSkill } from "../builtin/frontend/frontend-perf"
import { reactNextjsPatternsSkill } from "../builtin/frontend/frontend-react-nextjs"
import { frontendStateDataSkill } from "../builtin/frontend/frontend-state-data"
import { svelteSveltekitPatternsSkill } from "../builtin/frontend/frontend-svelte-sveltekit"
import { frontendTestingSkill } from "../builtin/frontend/frontend-testing"
import { frontendUiUxSkill } from "../builtin/frontend/frontend-ui-ux"
import { ccxtProWebsocketsSkill } from "../builtin/market-data/ccxt-pro-websockets"
import { ccxtRestSkill } from "../builtin/market-data/ccxt-rest"
import { cryptoMarketStructureSkill } from "../builtin/market-data/crypto-market-structure"
import { dataQualityObservabilitySkill } from "../builtin/market-data/data-quality-observability"
import { grafanaDashboardsSkill } from "../builtin/market-data/grafana-dashboards"
import { influxdbTimeseriesSkill } from "../builtin/market-data/influxdb-timeseries"
import { marketDataArchitectureSkill } from "../builtin/market-data/market-data-architecture"
import { marketDataBusSkill } from "../builtin/market-data/market-data-bus"
import { marketDataRobustnessReviewSkill } from "../builtin/market-data/market-data-robustness-review"
import { timeSeriesFundamentalsSkill } from "../builtin/market-data/time-series-fundamentals"
import { securityApiSkill } from "../builtin/security/security-api"
import { securityAuditSkill } from "../builtin/security/security-audit"
import { securityCoreSkill } from "../builtin/security/security-core"
import { securityCryptoSkill } from "../builtin/security/security-crypto"
import { securityDastSkill } from "../builtin/security/security-dast"
import { securityDependenciesSkill } from "../builtin/security/security-dependencies"
import { securityInfraSkill } from "../builtin/security/security-infra"
import { securityReviewSkill } from "../builtin/security/security-review"
import { securitySastSkill } from "../builtin/security/security-sast"
import { securitySecretsSkill } from "../builtin/security/security-secrets"
import { zeromqAdvancedReqrepSkill } from "../builtin/zeromq/zeromq-advanced-reqrep"
import { zeromqArchitectureSkill } from "../builtin/zeromq/zeromq-architecture"
import { zeromqCoreSkill } from "../builtin/zeromq/zeromq-core"
import { zeromqFrameworksSkill } from "../builtin/zeromq/zeromq-frameworks"
import { zeromqPubsubSkill } from "../builtin/zeromq/zeromq-pubsub"
import { zeromqReliabilitySkill } from "../builtin/zeromq/zeromq-reliability"
import { zeromqSocketsPatternsSkill } from "../builtin/zeromq/zeromq-sockets-patterns"
import { createLazyTemplateSkill } from "./lazy-skill-helper"
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
