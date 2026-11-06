/** ast-grep barrel: explicit named re-exports of local modules only. */
export {
  type RunOptions,
  runSg,
} from "./cli"
export {
  ensureCliAvailable,
  getAstGrepPath,
  isCliAvailable,
  startBackgroundInit,
} from "./cli-binary-path-resolution"
export {
  ensureAstGrepBinary,
  getBinaryName,
  getCacheDir,
  getCachedBinaryPath,
} from "./downloader"
export {
  checkEnvironment,
  type EnvironmentCheckResult,
  formatEnvironmentCheck,
} from "./environment-check"
export {
  CLI_LANGUAGES,
  DEFAULT_MAX_MATCHES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  LANG_EXTENSIONS,
} from "./language-support"
export {
  detectLanguageSpecificMistake,
  detectRegexMisuse,
  getPatternHint,
} from "./pattern-hints"
export {
  collectProcessOutputWithTimeout,
} from "./process-output-timeout"
export {
  formatReplaceResult,
  formatSearchResult,
} from "./result-formatter"
export {
  findSgCliPathSync,
  getSgCliPath,
  setSgCliPath,
} from "./sg-cli-path"
export {
  createSgResultFromStdout,
} from "./sg-compact-json-output"
export {
  AST_GREP_REPLACE_DESCRIPTION,
  AST_GREP_SEARCH_DESCRIPTION,
  AST_GREP_SEARCH_PATTERN_PARAM,
} from "./tool-descriptions"
export {
  createAstGrepTools,
} from "./tools"
export type {
  CliLanguage,
  CliMatch,
  Position,
  Range,
  SgResult,
} from "./types"
