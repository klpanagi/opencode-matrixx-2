/** github-search barrel: explicit named re-exports of local modules only. */
export {
  githubSearch,
} from "./cli"
export {
  CLONE_DEPTH,
  DEFAULT_LIMIT,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_TIMEOUT_MS,
  MAX_LIMIT,
  TMP_PREFIX,
} from "./constants"
export {
  formatGithubSearchResult,
} from "./result-formatter"
export {
  createGithubSearchTools,
} from "./tools"
export type {
  GithubSearchHit,
  GithubSearchOptions,
  GithubSearchResult,
} from "./types"
