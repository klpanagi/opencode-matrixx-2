/** secret-leak-guard barrel: explicit named re-exports of local modules only. */
export {
  isGitCommitOrPush,
  isGitPush,
} from "./git-command-detector"
export {
  type GitleaksFinding,
  runGitleaksPrePushScan,
  runGitleaksStagedScan,
} from "./gitleaks-runner"
export {
  createSecretLeakGuardHook,
} from "./hook"
export {
  extractRemoteBranch,
  formatFindings,
} from "./result-formatter"
