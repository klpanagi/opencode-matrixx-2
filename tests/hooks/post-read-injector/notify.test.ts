// Group C notify regression — post-read-injector.
// Actual hook paths:
// - src/hooks/post-read-injector/injector.ts (createUnifiedPostReadProcessor)
// - src/hooks/post-read-injector/hook.ts (createPostReadInjectorHook, PostToolUse)
// - barrel: src/hooks/post-read-injector/index.ts
import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearInjectedPaths } from "../../../src/hooks/directory-agents-injector/storage"
import { createUnifiedPostReadProcessor } from "../../../src/hooks/post-read-injector/injector"
import { clearInjectedRules } from "../../../src/hooks/rules-injector/storage"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"

type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}

function makeCtx() {
  const seen: ToastOpts[] = []
  const ctx = {
    directory: "",
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

function passthroughTruncator() {
  return {
    truncate: async (_sessionID: string, content: string) => ({ result: content, truncated: false }),
  }
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "post-read-notify-"))
  mkdirSync(join(root, ".git"), { recursive: true })
  mkdirSync(join(root, "a", "b"), { recursive: true })
  writeFileSync(join(root, "a", "AGENTS.md"), "# A agents")
  writeFileSync(join(root, "a", "b", "AGENTS.md"), "# B agents")
  const file = join(root, "a", "b", "file.txt")
  writeFileSync(file, "hello\n")
  return { root, file }
}

describe("post-read-injector notify (Task 5 Group C)", () => {
  test("transition → 1 toast; idempotent second call → 0 new toasts", async () => {
    //#given a fresh notifier and tmp project with AGENTS.md files
    resetInjectionNotifier()
    const { root, file } = makeProject()
    try {
      const sessionID = `post-read-notify-${Date.now()}-${randomUUID()}`
      const { ctx, seen } = makeCtx()
      const processor = createUnifiedPostReadProcessor({
        workspaceDirectory: root,
        truncator: passthroughTruncator(),
        ctx,
        injectorId: "post-read-injector",
      } as unknown as Parameters<typeof createUnifiedPostReadProcessor>[0])
      //#when first read injects directory context
      const first = { title: file, output: "", metadata: {} }
      await processor.processFilePathForInjection(file, sessionID, first)
      //#then one toast fires on transition
      expect(first.output.includes("[Directory Context]")).toBe(true)
      expect(seen.length).toBe(1)
      //#when same dir read again in same session (idempotent, marker present)
      const second = { title: file, output: "", metadata: {} }
      await processor.processFilePathForInjection(file, sessionID, second)
      //#then no duplicate injection and no second toast
      expect(second.output).toBe("")
      expect(seen.length).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
      try {
        clearInjectedPaths(`post-read-notify-cleanup`)
      } catch {}
    }
  })

  test("marker-present output → 0 toasts (early-return path)", async () => {
    //#given output already carrying a directory block
    resetInjectionNotifier()
    const { root, file } = makeProject()
    try {
      const sessionID = `post-read-notify-early-${Date.now()}-${randomUUID()}`
      const { ctx, seen } = makeCtx()
      const processor = createUnifiedPostReadProcessor({
        workspaceDirectory: root,
        truncator: passthroughTruncator(),
        ctx,
        injectorId: "post-read-injector",
      } as unknown as Parameters<typeof createUnifiedPostReadProcessor>[0])
      const output = { title: file, output: "prior\n\n[Directory Context]\nold", metadata: {} }
      //#when processor sees the marker
      await processor.processFilePathForInjection(file, sessionID, output)
      //#then output untouched and zero toasts
      expect(output.output).toBe("prior\n\n[Directory Context]\nold")
      expect(seen.length).toBe(0)
      try {
        clearInjectedRules(sessionID)
      } catch {}
      const { clearInjectedPaths: clearPaths } = await import(
        "../../../src/hooks/directory-agents-injector/storage"
      )
      try {
        clearPaths(sessionID)
      } catch {}
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
