import { consumeToolMetadata } from "../../features/tool-metadata-store"
import { log } from "../../shared/runtime/logger"
import type { DomainHooks } from "../setup-domains"

type ToolExecuteAfterInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteAfterOutput = { title: string; output: string; metadata: Record<string, unknown> }

type AfterHook = (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => unknown

type HookSlot = {
  readonly name: string
  readonly fn: AfterHook | undefined
}

/**
 * The post-tool chain, in the order it has always run in. A slot is skipped
 * when its hook is disabled (undefined), but every present slot is attempted
 * even if an earlier one throws.
 */
function buildChain(hooks: DomainHooks): readonly HookSlot[] {
  return [
    { name: "webfetchRedirectGuard", fn: hooks.webfetchRedirectGuard?.["tool.execute.after"] },
    { name: "contextWindowMonitor", fn: hooks.contextWindowMonitor?.["tool.execute.after"] },
    { name: "commentChecker", fn: hooks.commentChecker?.["tool.execute.after"] },
    { name: "directoryAgentsInjector", fn: hooks.directoryAgentsInjector?.["tool.execute.after"] },
    { name: "rulesInjector", fn: hooks.rulesInjector?.["tool.execute.after"] },
    {
      name: "emptyTaskResponseDetector",
      fn: hooks.emptyTaskResponseDetector?.["tool.execute.after"],
    },
    { name: "agentUsageReminder", fn: hooks.agentUsageReminder?.["tool.execute.after"] },
    { name: "categorySkillReminder", fn: hooks.categorySkillReminder?.["tool.execute.after"] },
    { name: "interactiveBashSession", fn: hooks.interactiveBashSession?.["tool.execute.after"] },
    { name: "editErrorRecovery", fn: hooks.editErrorRecovery?.["tool.execute.after"] },
    { name: "niobeHook", fn: hooks.niobeHook?.["tool.execute.after"] },
    { name: "taskResumeInfo", fn: hooks.taskResumeInfo?.["tool.execute.after"] },
    { name: "taskNotepadWriter", fn: hooks.taskNotepadWriter?.["tool.execute.after"] },
    { name: "hashlineReadEnhancer", fn: hooks.hashlineReadEnhancer?.["tool.execute.after"] },
    { name: "jsonErrorRecovery", fn: hooks.jsonErrorRecovery?.["tool.execute.after"] },
    { name: "readImageResizer", fn: hooks.readImageResizer?.["tool.execute.after"] },
    { name: "silentFailureGuard", fn: hooks.silentFailureGuard?.["tool.execute.after"] },
    { name: "sessionMemory", fn: hooks.sessionMemory?.["tool.execute.after"] },
  ]
}

/**
 * Runs one slot and contains its failure: the error is logged with the hook
 * name and dispatch continues with the next slot. Never rejects.
 */
async function runIsolatedHook(
  slot: HookSlot,
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
  failures: string[],
): Promise<void> {
  if (!slot.fn) return
  try {
    await slot.fn(input, output)
  } catch (error) {
    failures.push(slot.name)
    log("tool.execute.after hook failed", {
      hook: slot.name,
      tool: input.tool,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function createToolExecuteAfterHandler(args: {
  hooks: DomainHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output:
    | { title: string; output: string; metadata: Record<string, unknown> }
    | undefined,
) => Promise<void> {
  const { hooks } = args
  const chain = buildChain(hooks)

  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: Record<string, unknown> } | undefined,
  ): Promise<void> => {
    if (!output) return

    const stored = consumeToolMetadata(input.sessionID, input.callID)
    if (stored) {
      if (stored.title) {
        output.title = stored.title
      }
      if (stored.metadata) {
        output.metadata = { ...output.metadata, ...stored.metadata }
      }
    }

    const failures: string[] = []

    await runIsolatedHook(
      { name: "toolOutputTruncator", fn: hooks.toolOutputTruncator?.["tool.execute.after"] },
      input,
      output,
      failures,
    )

    // qualityGate keeps its concurrent position next to the sequential chain;
    // it gets the same per-hook isolation as every chain slot.
    await Promise.all([
      runIsolatedHook(
        { name: "qualityGate", fn: hooks.qualityGate?.["tool.execute.after"] },
        input,
        output,
        failures,
      ),
      (async () => {
        for (const slot of chain) {
          await runIsolatedHook(slot, input, output, failures)
        }
      })(),
    ])

    if (failures.length > 0) {
      log("tool.execute.after hooks failed", {
        tool: input.tool,
        count: failures.length,
        hooks: failures,
      })
    }
  }
}
