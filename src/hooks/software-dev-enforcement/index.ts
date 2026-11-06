/** software-dev-enforcement barrel: explicit named re-exports of local modules only. */
export {
  CODE_WRITING_SUBAGENT_TARGETS,
  HOOK_NAME,
  isCodeWritingPrompt,
  READ_ONLY_SUBAGENT_TARGETS,
  SOFTWARE_DEV_ENFORCEMENT_MARKER,
} from "./constants"
export {
  createSoftwareDevEnforcementHook,
} from "./hook"
