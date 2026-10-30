import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import type { MatrixxContext } from "../../../src/plugin/context"
import { ContextCollector } from "../../../src/features/context-injector"
import { detectDomainSkills } from "../../../src/hooks/domain-keyword-detector/detector"
import { createKnowledgeHubInjectorHook } from "../../../src/hooks/knowledge-hub-injector/hook"
import { detectKeywordsWithType } from "../../../src/hooks/keyword-detector/detector"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"
import { sanitizeKnownTags } from "../../../src/shared/system-directive"

//#given a mock ctx with a TUI showToast spy (mirrors tests/shared/injection-notifier.test.ts)
type ToastOpts = {
  body: { title: string; message: string; variant: "info"; duration: number }
}
function makeTuiCtx() {
  const seen: ToastOpts[] = []
  const client = {
    tui: {
      showToast: async (o: ToastOpts) => {
        seen.push(o)
        return {}
      },
    },
  }
  return { ctx: { directory: tmpdir(), client } as unknown as MatrixxContext, seen }
}

const tmpRoots: string[] = []
afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeHub(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "kb-hub-"))
  tmpRoots.push(root)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, name), content)
  }
  return root
}

function userMessages(sessionID: string) {
  return {
    messages: [
      {
        info: { id: "msg-1", role: "user", sessionID },
        parts: [{ type: "text", text: "hello", id: "prt-1", messageID: "msg-1", sessionID }],
      },
    ],
  }
}

function makeHook(
  ctx: MatrixxContext,
  root: string,
): { hook: ReturnType<typeof createKnowledgeHubInjectorHook>; collector: ContextCollector } {
  const collector = new ContextCollector()
  const hook = createKnowledgeHubInjectorHook(ctx, {
    hubs: [{ name: "kb", path: root, index: "_index.md", scope: "global", mode: "router-only", exclude: [] }],
    collector,
  })
  return { hook, collector }
}

async function runTransform(hook: ReturnType<typeof createKnowledgeHubInjectorHook>, sessionID: string): Promise<void> {
  const transform = hook["experimental.chat.messages.transform"]
  await transform({}, userMessages(sessionID) as unknown as Parameters<typeof transform>[1])
}

describe("knowledge-hub-injector injection notice", () => {
  test("first registration toasts once; already-injected second pass toasts 0x", async () => {
    //#given a fresh notifier and a hub with an index
    resetInjectionNotifier()
    const { ctx, seen } = makeTuiCtx()
    const root = makeHub({ "_index.md": `# Hub\n\nROUTER-INDEX-notify-a\n` })
    const { hook, collector } = makeHook(ctx, root)

    //#when the first transform registers the router
    await runTransform(hook, "ses-kb-1")
    //#then registration happened and exactly one toast fired
    expect(collector.hasPending("ses-kb-1")).toBe(true)
    expect(seen.length).toBe(1)
    collector.consume("ses-kb-1")

    //#when the same session transforms again (already-injected, no re-register)
    await runTransform(hook, "ses-kb-1")
    //#then no re-registration and no new toast
    expect(collector.hasPending("ses-kb-1")).toBe(false)
    expect(seen.length).toBe(1)
  })

  test("changed index content toasts again", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeTuiCtx()
    const rootA = makeHub({ "_index.md": `# Hub\n\nROUTER-INDEX-notify-a\n` })
    const { hook: hookA } = makeHook(ctx, rootA)
    await runTransform(hookA, "ses-kb-2")
    expect(seen.length).toBe(1)

    //#when different hub content is injected in the same session
    const rootB = makeHub({ "_index.md": `# Hub\n\nROUTER-INDEX-notify-b-CHANGED\n` })
    const { hook: hookB } = makeHook(ctx, rootB)
    await runTransform(hookB, "ses-kb-2")

    //#then the changed injection toasts again
    expect(seen.length).toBe(2)
  })

  test("empty hubs (early-return) never toast", async () => {
    //#given a hook with no hubs configured
    resetInjectionNotifier()
    const { ctx, seen } = makeTuiCtx()
    const collector = new ContextCollector()
    const hook = createKnowledgeHubInjectorHook(ctx, { hubs: [], collector })

    //#when the transform early-returns without mutation
    await runTransform(hook, "ses-kb-3")

    //#then nothing registered and no toast fired
    expect(collector.hasPending("ses-kb-3")).toBe(false)
    expect(seen.length).toBe(0)
  })

  test("notice is loop-safe: triggers neither keyword-detector nor domain-detector", async () => {
    //#given a first registration toast
    resetInjectionNotifier()
    const { ctx, seen } = makeTuiCtx()
    const root = makeHub({ "_index.md": `# Hub\n\nROUTER-INDEX-notify-c\n` })
    const { hook } = makeHook(ctx, root)
    await runTransform(hook, "ses-kb-4")
    expect(seen.length).toBe(1)

    //#when the notice body goes through both detector pipelines
    const body = seen[0].body.message
    const clean = sanitizeKnownTags(body, { presentation: "drop" })
    //#then zero detections in both, and the title stays short
    expect(detectKeywordsWithType(clean).length).toBe(0)
    expect(detectDomainSkills(clean).length).toBe(0)
    expect(body.length).toBeLessThanOrEqual(120)
    expect(seen[0].body.title.length).toBeLessThanOrEqual(30)
  })
})
