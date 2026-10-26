import { describe, expect, it } from "bun:test"
import { createSessionMemoryHook } from "../../../src/hooks/session-memory/index"

const ctx = { directory: "/tmp/session-memory-hook-test" } as never
const enabledMemory = { enabled: true, ignoreToolPrefixes: ["ctx_"] } as never

const createInput = (tool: string) => ({
  tool,
  sessionID: "ses-test",
  callID: "call-1",
})

const createOutput = (output: string) => ({
  title: "t",
  output,
  metadata: {},
})

describe("createSessionMemoryHook", () => {
  describe("#given memory.enabled false (default)", () => {
    describe("#when tool.execute.after and event fire", () => {
      it("#then handlers are no-ops and buffer stays empty", async () => {
        // #given a default (disabled) hook
        const hook = createSessionMemoryHook(ctx)
        // #when tool output arrives and an idle event fires
        await hook["tool.execute.after"](createInput("Read"), createOutput("hello world"))
        await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-test" } } })
        // #then nothing is staged and flush is a no-op
        expect(hook.pendingCount()).toBe(0)
        hook.flush("ses-test")
        expect(hook.pendingCount()).toBe(0)
      })
    })
  })

  describe("#given memory.enabled true", () => {
    describe("#when a normal tool completes", () => {
      it("#then output text is staged in memory without disk IO", async () => {
        // #given an enabled hook
        const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
        // #when a tool completes with text output
        await hook["tool.execute.after"](createInput("Read"), createOutput("file contents here"))
        // #then one entry is pending (hot path stages only, no flush)
        expect(hook.pendingCount()).toBe(1)
      })
    })

    describe("#when tool name matches an ignore prefix", () => {
      it("#then the output is skipped via startsWith prefix match", async () => {
        // #given an enabled hook with ctx_ ignored
        const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
        // #when a ctx_-prefixed tool completes
        await hook["tool.execute.after"](createInput("ctx_search"), createOutput("search results"))
        // #then nothing is staged
        expect(hook.pendingCount()).toBe(0)
      })
    })

    describe("#when output text is empty", () => {
      it("#then nothing is staged", async () => {
        // #given an enabled hook
        const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
        // #when a tool completes with blank output
        await hook["tool.execute.after"](createInput("Read"), createOutput("   "))
        // #then the buffer stays empty
        expect(hook.pendingCount()).toBe(0)
      })
    })

    describe("#when buffer exceeds its cap", () => {
      it("#then oldest entries are evicted and the buffer stays bounded", async () => {
        // #given an enabled hook
        const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
        // #when more than MAX_PENDING_ENTRIES tools complete
        for (let i = 0; i < 60; i++) {
          await hook["tool.execute.after"](
            { tool: "Read", sessionID: "ses-test", callID: `call-${i}` },
            createOutput(`output number ${i} with enough words`),
          )
        }
        // #then the buffer is capped at 50
        expect(hook.pendingCount()).toBe(50)
      })
    })

    describe("#when a non-idle event fires", () => {
      it("#then the buffer is left untouched", async () => {
        // #given an enabled hook with a staged entry
        const hook = createSessionMemoryHook(ctx, { memory: enabledMemory })
        await hook["tool.execute.after"](createInput("Read"), createOutput("staged text"))
        // #when an unrelated event fires
        await hook.event({ event: { type: "session.created", properties: {} } })
        // #then the entry is still pending
        expect(hook.pendingCount()).toBe(1)
      })
    })
  })
})
