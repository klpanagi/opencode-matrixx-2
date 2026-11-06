/** grep barrel: explicit named re-exports of local modules only. */
export {
  runRg,
} from "./cli"
export {
  DEFAULT_MAX_COLUMNS,
  DEFAULT_MAX_COUNT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILESIZE,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  GREP_SAFETY_FLAGS,
  type GrepBackend,
  RG_SAFETY_FLAGS,
  resolveGrepCli,
  resolveGrepCliWithAutoInstall,
} from "./constants"
export {
  downloadAndInstallRipgrep,
  findFileRecursive,
  getInstalledRipgrepPath,
} from "./downloader"
export {
  formatGrepResult,
} from "./result-formatter"
export {
  createGrepTools,
} from "./tools"
export type {
  GrepMatch,
  GrepOptions,
  GrepResult,
} from "./types"
