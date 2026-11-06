/** webfetch-redirect-guard barrel: explicit named re-exports of local modules only. */
export {
  DEFAULT_WEBFETCH_TIMEOUT_MS,
  MAX_WEBFETCH_REDIRECTS,
  MAX_WEBFETCH_TIMEOUT_MS,
  WEBFETCH_REDIRECT_ERROR_PATTERNS,
  WEBFETCH_REDIRECT_GUARD_STALE_TIMEOUT_MS,
  WEBFETCH_REDIRECT_STATUSES,
} from "./constants"
export {
  createWebFetchRedirectGuardHook,
} from "./hook"
export {
  resolveWebFetchRedirects,
  type WebFetchFormat,
} from "./redirect-resolution"
