/** Evolution layer cross-link (orchestration vs triggers vs actions):
 * - Triggers: this hook (`hooks/evolution-compressor`, with `hooks/evolution-hitl`, `hooks/evolution-watcher`, `hooks/evolution-quality-gate`) observes session/tool events
 *   and feeds the evolution pipeline.
 * - Orchestration: `features/evolution/` owns the pipeline, store, and writer.
 * - Actions: `tools/evolution` exposes agent-callable tools (propose/approve/query) on the store.
 */
/** evolution-compressor barrel: explicit named re-exports of local modules only. */
export {
  createHostLlmCall,
  parseModelOverride,
} from "./host-llm-call"
