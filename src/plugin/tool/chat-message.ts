import type { MatrixxConfig } from "../../config"
import {
  setSessionAgent,
  setSessionModel,
} from "../../features/session-state/state"
import { hasConnectedProvidersCache } from "../../shared"
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "../../shared/agent/agent-variant"
import { log } from "../../shared/runtime/logger"
import { notify } from "../../shared/runtime/notify"
import type { DomainHooks } from "../setup-domains"
import type { MatrixxContext } from "./context"

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
}
type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
type StartWorkHookOutput = { parts: Array<{ type: string; text?: string }> }

function isStartWorkHookOutput(value: unknown): value is StartWorkHookOutput {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const partsValue = record.parts
  if (!Array.isArray(partsValue)) return false
  return partsValue.every((part) => {
    if (typeof part !== "object" || part === null) return false
    const partRecord = part as Record<string, unknown>
    return typeof partRecord.type === "string"
  })
}

// Observer names in wave order, used to attribute a rejected allSettled
// outcome to the hook that produced it.
const OBSERVER_NAMES = ["stopContinuationGuard", "runtimeFallback"] as const

export function createChatMessageHandler(args: {
  ctx: MatrixxContext
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: DomainHooks
}): (input: ChatMessageInput, output: ChatMessageHandlerOutput) => Promise<void> {
  const { pluginConfig, firstMessageVariantGate, hooks } = args

  // Resolve the chat.message hook references once at handler creation so the
  // per-message path calls them directly instead of re-walking the optional
  // chains on every user message.
  const inputSecretGuardHook = hooks.inputSecretGuard?.["chat.message"]
  const stopContinuationGuardHook = hooks.stopContinuationGuard?.["chat.message"]
  const keywordDetectorHook = hooks.keywordDetector?.["chat.message"]
  const autoSlashCommandHook = hooks.autoSlashCommand?.["chat.message"]
  const startWorkHook = hooks.startWork?.["chat.message"]
  const designIntentPreserverHook = hooks.designIntentPreserver?.["chat.message"]
  const runtimeFallbackHook = hooks.runtimeFallback?.["chat.message"]

  return async (input: ChatMessageInput, output: ChatMessageHandlerOutput): Promise<void> => {
    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    if (input.model) {
      setSessionModel(input.sessionID, `${input.model.providerID}/${input.model.modelID}`)
    }

    const message = output.message

    if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
      if (message.variant === undefined) {
        const variant =
          input.model && input.agent
            ? resolveVariantForModel(pluginConfig, input.agent, input.model)
            : resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message.variant = variant
        }
      }
      firstMessageVariantGate.markApplied(input.sessionID)
    } else {
      if (input.model && input.agent && message.variant === undefined) {
        const variant = resolveVariantForModel(pluginConfig, input.agent, input.model)
        if (variant !== undefined) {
          message.variant = variant
        }
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }
    }

    // Hook classification (see `src/plugin/hook-mutation-classification.md`).
    //
    // Prompt/state mutators — strictly sequential, in this order. Each one
    // reads `output.parts` and folds content into the same text part, so
    // running them concurrently would stomp the earlier mutation:
    //   inputSecretGuard      prepends a secret-guard directive
    //   keywordDetector       prepends keyword blocks, sets message.variant
    //   autoSlashCommand      replaces the text part with a command template
    //   startWork             appends start-work context, switches the agent
    //   designIntentPreserver prepends the design-intent guardrail
    //
    // Read-only observers — disjoint state, safe to overlap with each other
    // and with the mutators. They never touch `output.parts`, and no
    // subsequent hook reads what they write:
    //   stopContinuationGuard only clears this session's stopped marker
    //   runtimeFallback       only writes message.model and its fallback map
    const observers = Promise.allSettled([
      stopContinuationGuardHook?.(input),
      runtimeFallbackHook?.(input, output),
    ])

    try {
      if (inputSecretGuardHook) await inputSecretGuardHook(input, output)
      if (keywordDetectorHook) await keywordDetectorHook(input, output)
      if (autoSlashCommandHook) await autoSlashCommandHook(input, output)
      if (startWorkHook && isStartWorkHookOutput(output)) {
        await startWorkHook(input, output)
      }
      if (designIntentPreserverHook) await designIntentPreserverHook(input, output)
    } finally {
      // Observers are isolated by allSettled; joining in the finally
      // guarantees they have settled before the handler returns even when a
      // prompt mutator throws.
      const outcomes = await observers
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index]
        if (outcome.status === "rejected") {
          log("[chat.message] read-only observer failed; continuing", {
            hook: OBSERVER_NAMES[index],
            sessionID: input.sessionID,
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason),
          })
        }
      }
    }

    if (!hasConnectedProvidersCache()) {
      notify("warn", "Provider Cache Missing: Model filtering disabled. RESTART OpenCode to enable full functionality.")
    }

    if (hooks.matrixLoop) {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      const isMatrixLoopTemplate =
        promptText.includes("You are starting a Matrix Loop") &&
        promptText.includes("<user-task>")
      const isCancelMatrixTemplate = promptText.includes(
        "Cancel the currently active Matrix Loop",
      )

      if (isMatrixLoopTemplate) {
        const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
        const rawTask = taskMatch?.[1]?.trim() || ""
        const quotedMatch = rawTask.match(/^["'](.+?)["']/)
        const prompt =
          quotedMatch?.[1] ||
          rawTask.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed"

        const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i)
        const promiseMatch = rawTask.match(
          /--completion-promise=["']?([^"'\s]+)["']?/i,
        )

        hooks.matrixLoop.startLoop(input.sessionID, prompt, {
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        })
      } else if (isCancelMatrixTemplate) {
        hooks.matrixLoop.cancelLoop(input.sessionID)
      }
    }
  }
}
