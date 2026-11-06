/** rules-injector barrel: explicit named re-exports of local modules only. */
export {
  createSessionCacheStore,
  type SessionInjectedRulesCache,
} from "./cache"
export {
  GITHUB_INSTRUCTIONS_PATTERN,
  PROJECT_MARKERS,
  PROJECT_RULE_FILES,
  PROJECT_RULE_SUBDIRS,
  RULE_EXTENSIONS,
  RULES_INJECTOR_STORAGE,
} from "./constants"
export {
  createRulesInjectorHook,
} from "./hook"
export {
  _resetRuleCacheForTesting,
  createRuleInjectionProcessor,
} from "./injector"
export {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from "./matcher"
export {
  getRuleInjectionFilePath,
} from "./output-path"
export {
  parseRuleFrontmatter,
} from "./parser"
export {
  findProjectRoot,
} from "./project-root-finder"
export {
  calculateDistance,
} from "./rule-distance"
export {
  findRuleFiles,
} from "./rule-file-finder"
export {
  findRuleFilesRecursive,
  safeRealpathSync,
} from "./rule-file-scanner"
export {
  clearInjectedRules,
  loadInjectedRules,
  saveInjectedRules,
} from "./storage"
export type {
  InjectedRulesData,
  RuleFileCandidate,
  RuleMetadata,
} from "./types"
