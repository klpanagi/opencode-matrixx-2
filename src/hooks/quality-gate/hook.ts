/**
 * Quality-gate hook — pure non-blocking check (D2 thin-wrapper state).
 *
 * D2 removed the custom format-on-write and lint runners: formatting is
 * owned by OpenCode's native `formatter` pipeline (see
 * `formatter-config-handler`), so this hook MUST NOT start child processes
 * or run timers. Lint/typecheck/test verification remains a *policy*
 * (see the `quality-gate` built-in skill), not a running task.
 *
 * The hook name is kept so existing `disabled_hooks: ["quality-gate"]`
 * entries keep parsing, and the `tool.execute.before/after` keys stay
 * registered for future pure checks.
 */

export function createQualityGateHook() {
  return {
    "tool.execute.before": async (
      _input: { tool: string; sessionID: string; callID: string },
      _output: { args: Record<string, unknown> },
    ): Promise<void> => {
      // Pure check: nothing to track. Formatting and lint feedback come
      // from the native pipeline; this hook always returns immediately.
    },

    "tool.execute.after": async (
      _input: { tool: string; sessionID: string; callID: string },
      _output: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> => {
      // Pure check: no Biome run here. The verification policy lives in
      // the `quality-gate` skill: bun run lint / typecheck / test / build.
    },
  }
}
