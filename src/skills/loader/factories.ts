import type { BrowserAutomationProvider } from "../../config/schema"
import { createLazyTemplateSkill } from "./lazy-skill-helper"
import type { BuiltinSkill } from "./types"

const BROWSER_SKILL_NAMES = new Set(["playwright", "agent-browser", "playwright-cli"])

/**
 * Per-name skill loaders. `bun build --splitting` turns each `require()`
 * into its own chunk, so importing this module stays allocation-only; the
 * ~740 KB skill tree is evaluated on first template access, not at init.
 */
const skillFactories: Record<string, () => BuiltinSkill> = {
  "playwright": () => require("../builtin/core/playwright").playwrightSkill,
  "agent-browser": () => require("../builtin/core/playwright").agentBrowserSkill,
  "playwright-cli": () => require("../builtin/core/playwright-cli").playwrightCliSkill,
  "frontend-ui-ux": () => require("../builtin/frontend/frontend-ui-ux").frontendUiUxSkill,
  "docker-master": () => require("../builtin/core/docker-master").dockerMasterSkill,
  "git-master": () => require("../builtin/core/git-master").gitMasterSkill,
  "dev-browser": () => require("../builtin/core/dev-browser").devBrowserSkill,
  "dsl-core": () => require("../builtin/dsl/dsl-core").dslCoreSkill,
  "dsl-grammar": () => require("../builtin/dsl/dsl-grammar").dslGrammarSkill,
  "dsl-codegen": () => require("../builtin/dsl/dsl-codegen").dslCodegenSkill,
  "dsl-metamodel": () => require("../builtin/dsl/dsl-metamodel").dslMetamodelSkill,
  "dsl-tooling": () => require("../builtin/dsl/dsl-tooling").dslToolingSkill,
  "dsl-textx-ecosystem": () => require("../builtin/dsl/dsl-textx-ecosystem").dslTextxEcosystemSkill,
  "dsl-pyecore-advanced": () => require("../builtin/dsl/dsl-pyecore-advanced").dslPyecoreAdvancedSkill,
  "dsl-model-transformation": () => require("../builtin/dsl/dsl-model-transformation").dslModelTransformationSkill,
  "dsl-testing": () => require("../builtin/dsl/dsl-testing").dslTestingSkill,
  "dsl-validation": () => require("../builtin/dsl/dsl-validation").dslValidationSkill,
  "dsl-composition": () => require("../builtin/dsl/dsl-composition").dslCompositionSkill,
  "frontend-a11y": () => require("../builtin/frontend/frontend-a11y").frontendA11ySkill,
  "bdd-backend": () => require("../builtin/bdd/bdd-backend").bddBackendSkill,
  "bdd-contract": () => require("../builtin/bdd/bdd-contract").bddContractSkill,
  "bdd-frontend": () => require("../builtin/bdd/bdd-frontend").bddFrontendSkill,
  "bdd-tests": () => require("../builtin/bdd/bdd-tests").bddTestsSkill,
  "frontend-build-tooling": () => require("../builtin/frontend/frontend-build-tooling").frontendBuildToolingSkill,
  "frontend-perf": () => require("../builtin/frontend/frontend-perf").frontendPerfSkill,
  "frontend-state-data": () => require("../builtin/frontend/frontend-state-data").frontendStateDataSkill,
  "frontend-testing": () => require("../builtin/frontend/frontend-testing").frontendTestingSkill,
  "react-nextjs-patterns": () => require("../builtin/frontend/frontend-react-nextjs").reactNextjsPatternsSkill,
  "svelte-sveltekit-patterns": () => require("../builtin/frontend/frontend-svelte-sveltekit").svelteSveltekitPatternsSkill,
  "document-reader": () => require("../builtin/core/document-reader").documentReaderSkill,
  "security-core": () => require("../builtin/security/security-core").securityCoreSkill,
  "security-secrets": () => require("../builtin/security/security-secrets").securitySecretsSkill,
  "security-sast": () => require("../builtin/security/security-sast").securitySastSkill,
  "security-dast": () => require("../builtin/security/security-dast").securityDastSkill,
  "security-dependencies": () => require("../builtin/security/security-dependencies").securityDependenciesSkill,
  "security-api": () => require("../builtin/security/security-api").securityApiSkill,
  "security-audit": () => require("../builtin/security/security-audit").securityAuditSkill,
  "security-crypto": () => require("../builtin/security/security-crypto").securityCryptoSkill,
  "security-infra": () => require("../builtin/security/security-infra").securityInfraSkill,
  "security-review": () => require("../builtin/security/security-review").securityReviewSkill,
  "tdd-enforcer": () => require("../builtin/core/tdd-enforcer").tddEnforcerSkill,
  "review-work": () => require("../builtin/core/review-work").reviewWorkSkill,
  "quality-gate": () => require("../builtin/core/quality-gate").qualityGateSkill,
  "software-dev": () => require("../builtin/core/software-dev").softwareDevSkill,
  "matrixx-self-config": () => require("../builtin/core/matrixx-self-config").matrixxSelfConfigSkill,
  "rp-research": () => require("../builtin/core/rp-research").rpResearchSkill,
  "remove-ai-slops": () => require("../builtin/core/remove-ai-slops").removeAiSlopsSkill,
  "zeromq-core": () => require("../builtin/zeromq/zeromq-core").zeromqCoreSkill,
  "zeromq-sockets-patterns": () => require("../builtin/zeromq/zeromq-sockets-patterns").zeromqSocketsPatternsSkill,
  "zeromq-advanced-reqrep": () => require("../builtin/zeromq/zeromq-advanced-reqrep").zeromqAdvancedReqrepSkill,
  "zeromq-reliability": () => require("../builtin/zeromq/zeromq-reliability").zeromqReliabilitySkill,
  "zeromq-pubsub": () => require("../builtin/zeromq/zeromq-pubsub").zeromqPubsubSkill,
  "zeromq-architecture": () => require("../builtin/zeromq/zeromq-architecture").zeromqArchitectureSkill,
  "zeromq-frameworks": () => require("../builtin/zeromq/zeromq-frameworks").zeromqFrameworksSkill,
  "python-asyncio": () => require("../builtin/core/python-asyncio").pythonAsyncioSkill,
  "ccxt-rest": () => require("../builtin/market-data/ccxt-rest").ccxtRestSkill,
  "ccxt-pro-websockets": () => require("../builtin/market-data/ccxt-pro-websockets").ccxtProWebsocketsSkill,
  "market-data-bus": () => require("../builtin/market-data/market-data-bus").marketDataBusSkill,
  "market-data-architecture": () => require("../builtin/market-data/market-data-architecture").marketDataArchitectureSkill,
  "market-data-robustness-review": () => require("../builtin/market-data/market-data-robustness-review").marketDataRobustnessReviewSkill,
  "crypto-market-structure": () => require("../builtin/market-data/crypto-market-structure").cryptoMarketStructureSkill,
  "time-series-fundamentals": () => require("../builtin/market-data/time-series-fundamentals").timeSeriesFundamentalsSkill,
  "influxdb-timeseries": () => require("../builtin/market-data/influxdb-timeseries").influxdbTimeseriesSkill,
  "grafana-dashboards": () => require("../builtin/market-data/grafana-dashboards").grafanaDashboardsSkill,
  "telegram-bot": () => require("../builtin/core/telegram-bot").telegramBotSkill,
  "resilience-error-taxonomy": () => require("../builtin/core/resilience-error-taxonomy").resilienceErrorTaxonomySkill,
  "resilience-failure-hunting": () => require("../builtin/core/resilience-failure-hunting").resilienceFailureHuntingSkill,
  "silent-failure-detection": () => require("../builtin/core/silent-failure-detection").silentFailureDetectionSkill,
  "systematic-debugging": () => require("../builtin/core/systematic-debugging").systematicDebuggingSkill,
  "bug-fixing": () => require("../builtin/core/bug-fixing").bugFixingSkill,
  "bug-hunting": () => require("../builtin/core/bug-hunting").bugHuntingSkill,
  "data-quality-observability": () => require("../builtin/market-data/data-quality-observability").dataQualityObservabilitySkill,
}

export interface CreateBuiltinSkillsOptions {
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
}

export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills: rawDisabledSkills } = options
  const disabledCopy = rawDisabledSkills instanceof Set ? new Set(rawDisabledSkills) : new Set(rawDisabledSkills ?? [])
  const disabledSkills = disabledCopy
  // The playwright-cli factory intentionally outputs name "playwright" (canonical
  // browser skill name swapped behind browserProvider). Map the schema name to the
  // output name so disabled_skills: ["playwright-cli"] actually disables it.
  if (browserProvider === "playwright-cli" && disabledSkills.has("playwright-cli")) {
    disabledSkills.add("playwright")
  }

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
