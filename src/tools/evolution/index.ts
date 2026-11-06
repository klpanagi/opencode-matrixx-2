/** Evolution layer cross-link (orchestration vs triggers vs actions):
 * - Actions: this module (`tools/evolution`) exposes agent-callable tools on the evolution store.
 * - Orchestration: `features/evolution/` owns the pipeline, store, and writer.
 * - Triggers: `hooks/evolution-hitl`, `hooks/evolution-watcher`, `hooks/evolution-compressor`,
 *   `hooks/evolution-quality-gate` observe session/tool events and feed the pipeline.
 */
export {
  AUDIT_TAIL_LIMIT,
  EVOLUTION_DESCRIPTION,
  EVOLUTION_QUERY_ACTIONS,
  EVOLUTION_TOOL_ACTIONS,
  GET_CONTEXT_CHAR_CAP,
  NO_PENDING_MESSAGE,
  NO_RETRIEVABLE_MESSAGE,
  SEARCH_RESULT_LIMIT,
  SLUG_PATTERN,
} from "./constants";
export { createEvolutionTool, type EvolutionToolOptions } from "./tools";
export type { EvolutionToolAction, EvolutionToolArgs, PendingProposalSummary } from "./types";
