// Group C notify regression — directory-agents-injector.
// Actual hook paths:
// - src/hooks/directory-agents-injector/injector.ts (processFilePathForAgentsInjection)
// - src/hooks/directory-agents-injector/hook.ts (createDirectoryAgentsInjectorHook → shared post-read factory, trackedTools ["read"])
// - storage: src/hooks/directory-agents-injector/storage.ts
import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { processFilePathForAgentsInjection } from "../../../src/hooks/directory-agents-injector/injector"
import { clearInjectedPaths } from "../../../src/hooks/directory-agents-injector/storage"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"

type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}

function makeCtx(directory: string) {
  const seen: ToastOpts[] = []
  const ctx = {
    directory,
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
  } as never
}

describe("directory-agents-injector notify (Task 5 Group C)", () => {
  test("transition → 1 toast; idempotent second call → 0 new toasts", async () => {
    //#given a tmp project with an AGENTS.md file
    resetInjectionNotifier()
    const root = mkdtempSync(join(tmpdir(), "dir-agents-notify-"))
    mkdirSync(join(root, "sub"), { recursive: true })
    writeFileSync(join(root, "sub", "AGENTS.md"), "# Sub agents")
    const file = join(root, "sub", "file.ts")
    writeFileSync(file, "console.log(1)\n")
    const sessionID = `dir-agents-notify-${Date.now()}-${randomUUID()}`
    try {
      const { ctx, seen } = makeCtx(root)
      const input = { ctx, truncator: passthroughTruncator(), sessionCaches: new Map() }
      //#when first read injects AGENTS.md
      const first = { title: "Result", output: "", metadata: {} }
      await processFilePathForAgentsInjection({ ...input, filePath: file, sessionID, output: first })
      //#then one toast fires on transition
      expect(first.output.includes("[Directory Context:")).toBe(true)
      expect(seen.length).toBe(1)
      //#when same file read again (cached dir → idempotent)
      const second = { title: "Result", output: "", metadata: {} }
      await processFilePathForAgentsInjection({ ...input, filePath: file, sessionID, output: second })
      //#then no duplicate injection and no second toast
      expect(second.output).toBe("")
      expect(seen.length).toBe(1)
    } finally {
      try {
        clearInjectedPaths(sessionID)
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  })
})
