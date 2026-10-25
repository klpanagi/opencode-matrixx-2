import type { BrowserAutomationProvider } from "../config/schema"
import { createLazyTemplateSkill } from "./lazy-skill-helper"
import { bddBackendSkill } from "./skills/bdd-backend"
import { bddContractSkill } from "./skills/bdd-contract"
import { bddFrontendSkill } from "./skills/bdd-frontend"
import { bddTestsSkill } from "./skills/bdd-tests"
import { ccxtProWebsocketsSkill } from "./skills/ccxt-pro-websockets"
import { ccxtRestSkill } from "./skills/ccxt-rest"
import { cryptoMarketStructureSkill } from "./skills/crypto-market-structure"
import { dataQualityObservabilitySkill } from "./skills/data-quality-observability"
import { devBrowserSkill } from "./skills/dev-browser"
import { dockerMasterSkill } from "./skills/docker-master"
import { documentReaderSkill } from "./skills/document-reader"
import { dslCodegenSkill } from "./skills/dsl-codegen"
import { dslCompositionSkill } from "./skills/dsl-composition"
import { dslCoreSkill } from "./skills/dsl-core"
import { dslGrammarSkill } from "./skills/dsl-grammar"
import { dslMetamodelSkill } from "./skills/dsl-metamodel"
import { dslModelTransformationSkill } from "./skills/dsl-model-transformation"
import { dslPyecoreAdvancedSkill } from "./skills/dsl-pyecore-advanced"
import { dslTestingSkill } from "./skills/dsl-testing"
import { dslTextxEcosystemSkill } from "./skills/dsl-textx-ecosystem"
import { dslToolingSkill } from "./skills/dsl-tooling"
import { dslValidationSkill } from "./skills/dsl-validation"
import { frontendA11ySkill } from "./skills/frontend-a11y"
import { frontendBuildToolingSkill } from "./skills/frontend-build-tooling"
import { frontendPerfSkill } from "./skills/frontend-perf"
import { reactNextjsPatternsSkill } from "./skills/frontend-react-nextjs"
import { frontendStateDataSkill } from "./skills/frontend-state-data"
import { svelteSveltekitPatternsSkill } from "./skills/frontend-svelte-sveltekit"
import { frontendTestingSkill } from "./skills/frontend-testing"
import { frontendUiUxSkill } from "./skills/frontend-ui-ux"
import { gitMasterSkill } from "./skills/git-master"
import { grafanaDashboardsSkill } from "./skills/grafana-dashboards"
import { influxdbTimeseriesSkill } from "./skills/influxdb-timeseries"
import { marketDataArchitectureSkill } from "./skills/market-data-architecture"
import { marketDataBusSkill } from "./skills/market-data-bus"
import { matrixxSelfConfigSkill } from "./skills/matrixx-self-config"
import { agentBrowserSkill, playwrightSkill } from "./skills/playwright"
import { playwrightCliSkill } from "./skills/playwright-cli"
import { pythonAsyncioSkill } from "./skills/python-asyncio"
import { qualityGateSkill } from "./skills/quality-gate"
import { removeAiSlopsSkill } from "./skills/remove-ai-slops"
import { resilienceErrorTaxonomySkill } from "./skills/resilience-error-taxonomy"
import { reviewWorkSkill } from "./skills/review-work"
import { securityApiSkill } from "./skills/security-api"
import { securityCoreSkill } from "./skills/security-core"
import { securityCryptoSkill } from "./skills/security-crypto"
import { securityDastSkill } from "./skills/security-dast"
import { securityDependenciesSkill } from "./skills/security-dependencies"
import { securityInfraSkill } from "./skills/security-infra"
import { securityReviewSkill } from "./skills/security-review"
import { securitySastSkill } from "./skills/security-sast"
import { securitySecretsSkill } from "./skills/security-secrets"
import { silentFailureDetectionSkill } from "./skills/silent-failure-detection"
import { softwareDevSkill } from "./skills/software-dev"
import { tddEnforcerSkill } from "./skills/tdd-enforcer"
import { telegramBotSkill } from "./skills/telegram-bot"
import { timeSeriesFundamentalsSkill } from "./skills/time-series-fundamentals"
import { ulwResearchSkill } from "./skills/ulw-research"
import { zeromqAdvancedReqrepSkill } from "./skills/zeromq-advanced-reqrep"
import { zeromqArchitectureSkill } from "./skills/zeromq-architecture"
import { zeromqCoreSkill } from "./skills/zeromq-core"
import { zeromqFrameworksSkill } from "./skills/zeromq-frameworks"
import { zeromqPubsubSkill } from "./skills/zeromq-pubsub"
import { zeromqReliabilitySkill } from "./skills/zeromq-reliability"
import { zeromqSocketsPatternsSkill } from "./skills/zeromq-sockets-patterns"
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
  "crypto-market-structure": () => cryptoMarketStructureSkill,
  "time-series-fundamentals": () => timeSeriesFundamentalsSkill,
  "influxdb-timeseries": () => influxdbTimeseriesSkill,
  "grafana-dashboards": () => grafanaDashboardsSkill,
  "telegram-bot": () => telegramBotSkill,
  "resilience-error-taxonomy": () => resilienceErrorTaxonomySkill,
  "silent-failure-detection": () => silentFailureDetectionSkill,
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
