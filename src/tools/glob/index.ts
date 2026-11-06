/** glob barrel: explicit named re-exports of local modules only. */
export {
  buildFindArgs,
  buildPowerShellCommand,
  buildRgArgs,
  type ResolvedCli,
  runRgFiles,
} from "./cli"
export {
  DEFAULT_LIMIT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  RG_FILES_FLAGS,
} from "./constants"
export {
  formatGlobResult,
} from "./result-formatter"
export {
  createGlobTools,
} from "./tools"
export type {
  FileMatch,
  GlobOptions,
  GlobResult,
} from "./types"
