/** non-interactive-env barrel: explicit named re-exports of local modules only. */
export {
  HOOK_NAME,
  NON_INTERACTIVE_ENV,
  SHELL_COMMAND_PATTERNS,
} from "./constants"
export {
  isNonInteractive,
} from "./detector"
export {
  createNonInteractiveEnvHook,
} from "./non-interactive-env-hook"
