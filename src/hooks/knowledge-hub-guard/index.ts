/** knowledge-hub-guard barrel: explicit named re-exports of local modules only. */
export {
  approveHubWrite,
  clearHubWriteApprovals,
  HUB_WRITE_APPROVAL_TTL_MS,
  isHubWriteApproved,
  normalizeApprovedPath,
} from "./approvals"
export {
  createKnowledgeHubGuardHook,
  type KnowledgeHubGuardOptions,
} from "./hook"
