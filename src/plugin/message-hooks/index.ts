import type { EvolutionHitlDeps } from "../../hooks/evolution-hitl/flat"
import type { SessionMessage } from "../../shared/session-message"
import type { MatrixxContext, V2Registration } from "../context"
import { type ContextInjectorDeps, registerContextInjectorMessagesTransform } from "./context-injector"
import { registerDcpNudgeSanitizer } from "./dcp-nudge-sanitizer"
import { registerDomainKeywordDetector } from "./domain-keyword-detector"
import { registerEnvContextInjector } from "./env-context-injector"
import { registerEvolutionHitl } from "./evolution-hitl"
import { type KnowledgeHubInjectorDeps, registerKnowledgeHubInjector } from "./knowledge-hub-injector"
import { registerThinkingBlockValidator } from "./thinking-block-validator"
import { registerToolPairValidator } from "./tool-pair-validator"

/** Native session hook kinds that carry messages. */
export type NativeMessageHookKind = "context" | "compaction" | "generate"

/**
 * The 8 transform hooks, keyed exactly as in `DomainHooks`
 * (`TransformHooks` for the first seven, `ContinuationHooks` for `evolutionHitl`).
 */
export type MessageHookName =
  | "domainKeywordDetector"
  | "knowledgeHubInjector"
  | "contextInjectorMessagesTransform"
  | "envContextInjector"
  | "thinkingBlockValidator"
  | "evolutionHitl"
  | "dcpNudgeSanitizer"
  | "toolPairValidator"

export interface MessageHookRow {
  /** What the hook reads in the V1 `experimental.chat.messages.transform` payload. */
  readonly hook: MessageHookName
  /** What the hook reads in the V1 `experimental.chat.messages.transform` payload. */
  readonly v1Reads: string
  /** What the hook reads in the V2 flat-`Message[]` session event. */
  readonly v2Reads: string
  /** Native session-hook kinds this hook registers on (never empty). */
  readonly targetHooks: readonly NativeMessageHookKind[]
}

/**
 * The 8-row mapping table, in legacy fan-out call order.
 * Task 26 ports one flat-`Message[]` body per row.
 */
export const MESSAGE_HOOK_TABLE: readonly MessageHookRow[] = [
  {
    hook: "domainKeywordDetector",
    v1Reads: "output.messages[].info.role + parts[].text (domain keyword scan)",
    v2Reads: "event.messages flat Message[] (.type/.text per message)",
    targetHooks: ["context"],
  },
  {
    hook: "knowledgeHubInjector",
    v1Reads: "last user message parts[].text (hub context match)",
    v2Reads: "event.messages flat Message[] (last user text)",
    targetHooks: ["context"],
  },
  {
    hook: "contextInjectorMessagesTransform",
    v1Reads: "last user message info.sessionID + parts[].text (collector injection point)",
    v2Reads: "event.messages flat Message[] (last user text insertion)",
    targetHooks: ["context", "compaction"],
  },
  {
    hook: "envContextInjector",
    v1Reads: "output.messages[] (env context injection)",
    v2Reads: "event.messages flat Message[] + event.system",
    targetHooks: ["context", "compaction"],
  },
  {
    hook: "thinkingBlockValidator",
    v1Reads: "assistant messages parts[] (thinking/redacted_thinking vs tool_use order)",
    v2Reads: "event.messages flat Message[] (assistant content blocks)",
    targetHooks: ["context", "generate"],
  },
  {
    hook: "evolutionHitl",
    v1Reads: "output.messages[] (pending-review prompt injection)",
    v2Reads: "event.messages flat Message[]",
    targetHooks: ["context"],
  },
    // Ordering: Matrixx runs before DCP (plugin index 0 vs 1), so this sanitizer
    // cleans prior-cycle sticky nudges and caps accumulation at ~1/cycle. It cannot
    // suppress the nudge DCP injects later in the same cycle.
  {
    hook: "dcpNudgeSanitizer",
    v1Reads: "user message parts[] synthetic sticky-nudge sweep",
    v2Reads: "event.messages flat Message[] synthetic text sweep",
    targetHooks: ["context"],
  },
  {
    hook: "toolPairValidator",
    v1Reads: "assistant messages parts[] (AssistantTool tool_use/tool_result pairing)",
    v2Reads: "event.messages flat Message[] (tool call/result pairing)",
    targetHooks: ["context", "generate"],
  },
]

/**
 * Fail-closed shape gate for the mapping table (Task 25 negative controls):
 * - exactly 8 rows,
 * - no row with an empty `targetHooks` (a hook registered nowhere runs nowhere),
 * - `toolPairValidator` includes `generate` (auxiliary requests bypass `context`).
 */
export function validateMessageHookTable(table: readonly MessageHookRow[]): void {
  if (table.length !== 8) {
    throw new Error(`message-hooks: expected exactly 8 mapping rows, got ${table.length}`)
  }
  for (const row of table) {
    if (row.targetHooks.length === 0) {
      throw new Error(
        `message-hooks: row "${row.hook}" has empty targetHooks — every hook needs >= 1 native kind`,
      )
    }
  }
  const toolPair = table.find((row) => row.hook === "toolPairValidator")
  if (!toolPair?.targetHooks.includes("generate")) {
    throw new Error(
      'message-hooks: toolPairValidator must include "generate" in targetHooks (auxiliary requests bypass "context")',
    )
  }
}

/** Optional per-hook dependency overrides for the Task 26 flat ports. */
export interface MessageHookDeps {
  readonly knowledgeHub?: KnowledgeHubInjectorDeps
  readonly contextInjector?: ContextInjectorDeps
  readonly evolutionHitl?: EvolutionHitlDeps & { readonly config?: unknown }
}

/**
 * Register every mapping row through its per-hook module in
 * `MESSAGE_HOOK_TABLE` order (the legacy fan-out call order). Each module
 * registers one native hook per target kind in its row and dispatches to
 * the Task 26 flat-`Message[]` port, so every row is live.
 * Design intent (layout, rhythm, affordances) is untouched.
 *
 * Each registered callback is fail-open on malformed input: an event without
 * a `messages` array is a no-op that never throws.
 */
export async function registerMessageHooks(
  ctx: MatrixxContext,
  deps: MessageHookDeps = {},
): Promise<V2Registration[]> {
  validateMessageHookTable(MESSAGE_HOOK_TABLE)
  const registrations: V2Registration[] = []
  registrations.push(...(await registerDomainKeywordDetector(ctx)))
  registrations.push(...(await registerKnowledgeHubInjector(ctx, deps.knowledgeHub ?? {})))
  registrations.push(...(await registerContextInjectorMessagesTransform(ctx, deps.contextInjector ?? {})))
  registrations.push(...(await registerEnvContextInjector(ctx)))
  registrations.push(...(await registerThinkingBlockValidator(ctx)))
  registrations.push(...(await registerEvolutionHitl(ctx, deps.evolutionHitl)))
  registrations.push(...(await registerDcpNudgeSanitizer(ctx)))
  registrations.push(...(await registerToolPairValidator(ctx)))
  return registrations
}

export type { SessionMessage }
