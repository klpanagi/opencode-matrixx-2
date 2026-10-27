import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { DomainHooks } from "./setup-domains"

export function createToolExecuteAfterHandler(args: {
  hooks: DomainHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output:
    | { title: string; output: string; metadata: Record<string, unknown> }
    | undefined,
) => Promise<void> {
  const { hooks } = args

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

    await hooks.toolOutputTruncator?.["tool.execute.after"]?.(input, output)

    const remainingHooks = async () => {
      await hooks.webfetchRedirectGuard?.["tool.execute.after"]?.(input, output)
      await hooks.evolutionWatcher?.["tool.execute.after"]?.(input, output)
      await hooks.contextWindowMonitor?.["tool.execute.after"]?.(input, output)
      await hooks.commentChecker?.["tool.execute.after"]?.(input, output)
      await hooks.directoryAgentsInjector?.["tool.execute.after"]?.(input, output)
      await hooks.rulesInjector?.["tool.execute.after"]?.(input, output)
      await hooks.emptyTaskResponseDetector?.["tool.execute.after"]?.(input, output)
      await hooks.agentUsageReminder?.["tool.execute.after"]?.(input, output)
      await hooks.categorySkillReminder?.["tool.execute.after"]?.(input, output)
      await hooks.interactiveBashSession?.["tool.execute.after"]?.(input, output)
      await hooks.editErrorRecovery?.["tool.execute.after"]?.(input, output)
      await hooks.delegateTaskRetry?.["tool.execute.after"]?.(input, output)
      await hooks.niobeHook?.["tool.execute.after"]?.(input, output)
      await hooks.taskResumeInfo?.["tool.execute.after"]?.(input, output)
      await hooks.taskNotepadWriter?.["tool.execute.after"]?.(input, output)
      await hooks.hashlineReadEnhancer?.["tool.execute.after"]?.(input, output)
      await hooks.jsonErrorRecovery?.["tool.execute.after"]?.(input, output)
      await hooks.readImageResizer?.["tool.execute.after"]?.(input, output)
      await hooks.silentFailureGuard?.["tool.execute.after"]?.(input, output)
      await hooks.sessionMemory?.["tool.execute.after"]?.(input, output)
    }

    await Promise.all([
      hooks.qualityGate?.["tool.execute.after"]?.(input, output),
      remainingHooks(),
    ])
  }
}
