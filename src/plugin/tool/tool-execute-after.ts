import { consumeToolMetadata } from "../../features/tool-metadata-store"
import { log } from "../../shared/runtime/logger"
import type { DomainHooks } from "../setup-domains"

type ToolExecuteAfterInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteAfterOutput = { title: string; output: string; metadata: Record<string, unknown> }

type AfterHook = (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => unknown

type HookSlot = {
  readonly name: string
  readonly fn: AfterHook | undefined
  /**
   * Marks a hook that only observes: it appends a reminder (one synchronous
   * read-modify-write) or records state, and never replaces `output.output`
   * from a stale snapshot. Consecutive observers share one `Promise.allSettled`
   * wave; the wave is drained before the next sequential slot runs, so the
   * invocation order of the chain never changes.
   */
  readonly observer?: true
}

type ChainStep =
  | { readonly kind: "wave"; readonly slots: readonly HookSlot[] }
  | { readonly kind: "sequential"; readonly slot: HookSlot }

/**
 * The post-tool chain, in the order it has always run in. A slot is skipped
 * when its hook is disabled (undefined), but every present slot is attempted
 * even if an earlier one throws.
 *
 * Sequential slots (no `observer` flag) rewrite `output.output` — either
 * wholesale or from a value read before an await — so they must not overlap.
 */
function buildChain(hooks: DomainHooks): readonly HookSlot[] {
  return [
    { name: "webfetchRedirectGuard", fn: hooks.webfetchRedirectGuard?.["tool.execute.after"] },
    {
      name: "contextWindowMonitor",
      fn: hooks.contextWindowMonitor?.["tool.execute.after"],
      observer: true,
    },
    { name: "commentChecker", fn: hooks.commentChecker?.["tool.execute.after"], observer: true },
    {
      name: "directoryAgentsInjector",
      fn: hooks.directoryAgentsInjector?.["tool.execute.after"],
      observer: true,
    },
    { name: "rulesInjector", fn: hooks.rulesInjector?.["tool.execute.after"], observer: true },
    {
      name: "emptyTaskResponseDetector",
      fn: hooks.emptyTaskResponseDetector?.["tool.execute.after"],
    },
    {
      name: "agentUsageReminder",
      fn: hooks.agentUsageReminder?.["tool.execute.after"],
      observer: true,
    },
    {
      name: "categorySkillReminder",
      fn: hooks.categorySkillReminder?.["tool.execute.after"],
      observer: true,
    },
    {
      name: "interactiveBashSession",
      fn: hooks.interactiveBashSession?.["tool.execute.after"],
      observer: true,
    },
    {
      name: "editErrorRecovery",
      fn: hooks.editErrorRecovery?.["tool.execute.after"],
      observer: true,
    },
    { name: "niobeHook", fn: hooks.niobeHook?.["tool.execute.after"] },
    { name: "taskResumeInfo", fn: hooks.taskResumeInfo?.["tool.execute.after"] },
    { name: "taskNotepadWriter", fn: hooks.taskNotepadWriter?.["tool.execute.after"] },
    { name: "hashlineReadEnhancer", fn: hooks.hashlineReadEnhancer?.["tool.execute.after"] },
    {
      name: "jsonErrorRecovery",
      fn: hooks.jsonErrorRecovery?.["tool.execute.after"],
      observer: true,
    },
    { name: "readImageResizer", fn: hooks.readImageResizer?.["tool.execute.after"], observer: true },
    {
      name: "silentFailureGuard",
      fn: hooks.silentFailureGuard?.["tool.execute.after"],
      observer: true,
    },
    { name: "sessionMemory", fn: hooks.sessionMemory?.["tool.execute.after"] },
  ]
}

/**
 * Folds the chain into steps once, at handler creation: a run of enabled
 * observers becomes one wave, every enabled sequential slot becomes its own
 * step in source order.
 */
function planChain(chain: readonly HookSlot[]): readonly ChainStep[] {
  const steps: ChainStep[] = []
  let wave: HookSlot[] = []

  const flush = (): void => {
    if (wave.length === 0) return
    steps.push({ kind: "wave", slots: wave })
    wave = []
  }

  for (const slot of chain) {
    if (!slot.fn) continue
    if (slot.observer) {
      wave.push(slot)
      continue
    }
    flush()
    steps.push({ kind: "sequential", slot })
  }

  flush()
  return steps
}

function recordFailure(
  slot: HookSlot,
  input: ToolExecuteAfterInput,
  error: unknown,
  failures: string[],
): void {
  failures.push(slot.name)
  log("tool.execute.after hook failed", {
    hook: slot.name,
    tool: input.tool,
    error: error instanceof Error ? error.message : String(error),
  })
}

/**
 * Starts one slot and turns a synchronous throw into a rejection, so every
 * call site can rely on the promise's outcome alone.
 */
function invokeHook(
  fn: AfterHook,
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
): Promise<unknown> {
  try {
    return Promise.resolve(fn(input, output))
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Runs one slot and contains its failure: the error is logged with the hook
 * name and dispatch continues with the next step. Never rejects.
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
    recordFailure(slot, input, error, failures)
  }
}

/**
 * Runs a wave of observers concurrently. `Promise.allSettled` keeps a rejecting
 * member from cancelling its siblings; each settled rejection is logged the
 * same way the sequential lane logs one.
 */
async function runWave(
  wave: readonly HookSlot[],
  input: ToolExecuteAfterInput,
  output: ToolExecuteAfterOutput,
  failures: string[],
): Promise<void> {
  const started: Array<{ slot: HookSlot; promise: Promise<unknown> }> = []
  for (const slot of wave) {
    if (!slot.fn) continue
    started.push({ slot, promise: invokeHook(slot.fn, input, output) })
  }

  const results = await Promise.allSettled(started.map((entry) => entry.promise))
  for (const [index, result] of results.entries()) {
    if (result.status !== "rejected") continue
    const entry = started[index]
    if (entry) recordFailure(entry.slot, input, result.reason, failures)
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
  const plan = planChain(buildChain(hooks))

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

    // qualityGate never reads or writes the output payload; it stays in the
    // sequential lane so the observer waves hold only the post-hooks.
    await runIsolatedHook(
      { name: "qualityGate", fn: hooks.qualityGate?.["tool.execute.after"] },
      input,
      output,
      failures,
    )

    for (const step of plan) {
      if (step.kind === "wave") {
        await runWave(step.slots, input, output, failures)
        continue
      }
      await runIsolatedHook(step.slot, input, output, failures)
    }

    if (failures.length > 0) {
      log("tool.execute.after hooks failed", {
        tool: input.tool,
        count: failures.length,
        hooks: failures,
      })
    }
  }
}
