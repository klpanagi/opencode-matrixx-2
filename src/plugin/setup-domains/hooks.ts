import type { MatrixxConfig } from "../../config"
import {
  formatCompactionAppendLog,
  log,
  summarizeCompactionAppend,
  utf8ByteLength,
} from "../../shared"
import type { createFirstMessageVariantGate } from "../../shared/session/first-message-variant"
import type { SessionContextCarrier } from "../../shared/session/session-context-source"
import type { ContinuationHooks } from "../hooks/create-continuation-hooks"
import type { SessionHooks } from "../hooks/create-session-hooks"
import type { SkillHooks } from "../hooks/create-skill-hooks"
import type { ToolGuardHooks } from "../hooks/create-tool-guard-hooks"
import type { TransformHooks } from "../hooks/create-transform-hooks"
import { createChatMessageHandler } from "../tool/chat-message"
import { createChatParamsHandler } from "../tool/chat-params"
import type { MatrixxContext } from "../tool/context"
import type { Hooks } from "../tool/legacy-hooks"
import { createToolDefinitionHandler } from "../tool/tool-definition"
import { createToolExecuteAfterHandler } from "../tool/tool-execute-after"
import { createToolExecuteBeforeHandler } from "../tool/tool-execute-before"

/**
 * Every hook the plugin owns, keyed by domain. Same shape the 3-tier
 * grouping produced — the tiers are gone, the leaf domains remain.
 */
export type DomainHooks = SessionHooks &
  ToolGuardHooks &
  TransformHooks &
  ContinuationHooks &
  SkillHooks

type FirstMessageVariantGate = ReturnType<typeof createFirstMessageVariantGate>

/** Chat domain: message, params, and message/system transforms. */
export function setupChatHooks(args: {
  ctx: MatrixxContext
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: DomainHooks
}): Pick<
  Hooks,
  | "chat.message"
  | "chat.params"
  | "experimental.chat.system.transform"
> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args

  return {
    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "chat.params": createChatParamsHandler({ anthropicEffort: hooks.anthropicEffort }),

    "experimental.chat.system.transform": async (input, output): Promise<void> => {
      await hooks.contextModeRouting(input, output)
      await hooks.rtkRouting(input, output)
    },
  }
}
/** Tool domain: execute guards and tool definition passthrough. */
export function setupToolHooks(args: {
  ctx: MatrixxContext & SessionContextCarrier
  hooks: DomainHooks
}): Pick<Hooks, "tool.execute.before" | "tool.execute.after" | "tool.definition"> {
  const { ctx, hooks } = args

  return {
    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      hooks,
    }),

    "tool.definition": createToolDefinitionHandler({
      hooks,
    }),
  }
}

/** Compaction domain: the single session-compacting contributor. */
export function setupCompactionHooks(args: {
  hooks: DomainHooks
}): Pick<Hooks, "experimental.session.compacting"> {
  const { hooks } = args

  return {
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      let injectorBytes = 0
      let planBytes = 0
      if (hooks.compactionContextInjector) {
        const fragment = hooks.compactionContextInjector(input.sessionID)
        injectorBytes = utf8ByteLength(fragment)
        output.context.push(fragment)
      }

      // Inject plan context if mission is active
      if (hooks.planPersister) {
        const planContext = hooks.planPersister.buildRehydrationContext(input.sessionID)
        if (planContext) {
          planBytes = utf8ByteLength(planContext)
          output.context.push(planContext)
        }
      }

      const summary = summarizeCompactionAppend({ injector: injectorBytes, plan: planBytes })
      log(formatCompactionAppendLog(input.sessionID, summary.sources), { sessionID: input.sessionID, addedBytes: summary.addedBytes, sources: summary.sources, hostTruncation: "not-performed-by-matrixx" })
    },
  }
}
