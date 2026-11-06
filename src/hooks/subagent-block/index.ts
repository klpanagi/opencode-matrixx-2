/** subagent-block barrel: explicit named re-exports of local modules only. */
export {
  BLOCK_MESSAGE,
  BYPASS_LOG_PREFIX,
  HOOK_NAME,
} from "./constants"
export {
  createSubagentBlockHook,
  type SubagentBlockContext,
  type SubagentBlockHookOptions,
} from "./hook"
