/** input-secret-guard barrel: explicit named re-exports of local modules only. */
export {
  BLOCKLIST_RULES,
  type DetectionRule,
  type Rule,
  type RuleSeverity,
  WARNLIST_HEURISTICS,
} from "./detection-rules"
export {
  type CompiledRule,
  detectSecrets,
  type Finding,
  hashFinding,
  redactMatch,
  shannonEntropy,
} from "./detector"
export {
  createInputSecretGuardHook,
} from "./hook"
export {
  allowOnce,
  allowSession,
  clearAll,
  clearSession,
  consumeOneShot,
  isSessionAllowed,
} from "./session-allow-cache"
