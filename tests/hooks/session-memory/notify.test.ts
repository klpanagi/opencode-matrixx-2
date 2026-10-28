// Group C notify regression — session-memory.
// Actual hook paths:
// - src/hooks/session-memory/hook.ts (createSessionMemoryHook, PostToolUse stage + event flush)
// - src/hooks/session-memory/index.ts (barrel)
import { describe, expect, test } from "bun:test"
import { createSessionMemoryHook } from "../../../src/hooks/session-memory/index"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"

type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}

function makeCtx() {
  const seen: ToastOpts[] = []
  const ctx = {
    directory: "/tmp/session-memory-notify-test",
    client: {
      tui: {
        showToast: async (o: ToastOpts) => {
          seen.push(o)
          return {}
        },
      },
    },
  } as never
  return { ctx, seen }
}

const enabledMemory = { enabled: true, ignoreToolPrefixes: ["ctx_"] } as never

async function tick() {
  await new Promise((r) => setTimeout(r, 10))
}

describe("session-memory notify (Task 5 Group C)", () => {
  test("flush with staged entries → 1 toast; empty flush → 0 new toasts", async () => {
    //#given a fresh notifier and an enabled hook with staged text
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
    const sessionID = "mem-notify-transition"
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-1" },
      { title: "t", output: "file contents here", metadata: {} },
    )
    expect(hook.pendingCount()).toBe(1)
    //#when flushing staged entries to disk
    hook.flush(sessionID)
    await tick()
    //#then exactly one toast fires on transition
    expect(hook.pendingCount()).toBe(0)
    expect(seen.length).toBe(1)
    //#when flushing again with nothing staged (idempotent)
    hook.flush(sessionID)
    await tick()
    //#then no second toast
    expect(seen.length).toBe(1)
  })

  test("ignored tool and empty output → 0 toasts", async () => {
    //#given an enabled hook fed only ignorable outputs
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
    const sessionID = "mem-notify-idempotent"
    await hook["tool.execute.after"](
      { tool: "ctx_search", sessionID, callID: "call-1" },
      { title: "t", output: "search results", metadata: {} },
    )
    await hook["tool.execute.after"](
      { tool: "Read", sessionID, callID: "call-2" },
      { title: "t", output: "   ", metadata: {} },
    )
    expect(hook.pendingCount()).toBe(0)
    //#when flushing with nothing staged
    hook.flush(sessionID)
    await tick()
    //#then zero toasts
    expect(seen.length).toBe(0)
  })
})
