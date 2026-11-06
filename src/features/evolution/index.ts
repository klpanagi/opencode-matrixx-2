/** Evolution layer cross-link (orchestration vs triggers vs actions):
 * - Orchestration: this module (`features/evolution/`) owns the pipeline, store, and writer.
 * - Triggers: `hooks/evolution-hitl`, `hooks/evolution-watcher`, `hooks/evolution-compressor`,
 *   `hooks/evolution-quality-gate` observe session/tool events and feed the pipeline.
 * - Actions: `tools/evolution` exposes agent-callable tools (propose/approve/query) on the store.
 */
export { createCompressor } from "./compressor";
export { LlmCompressor } from "./compressor/llm";
export * from "./evaluator";
export * from "./pipeline";
export * from "./store/budget-ledger"
export * from "./store/lifecycle"
export * from "./store/project-identity"
export * from "./store/query"
export * from "./store/trace-store"
export * from "./types";
export * from "./writer";
