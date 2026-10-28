import { describe, expect, test } from "bun:test"
import { detectKeywordsWithType } from "../../src/hooks/keyword-detector/detector"
import { notifyInjection, resetInjectionNotifier } from "../../src/shared/injection-notifier"
import { sanitizeKnownTags } from "../../src/shared/system-directive"

//#given a mock ctx with a TUI showToast spy
type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}
function makeCtx(opts: { withTui: boolean; reject?: boolean }) {
  const seen: ToastOpts[] = []
  const client = opts.withTui
    ? {
        tui: {
          showToast: async (o: ToastOpts) => {
            if (opts.reject) throw new Error("tui gone")
            seen.push(o)
            return {}
          },
        },
      }
    : {}
  return { ctx: { client } as never, seen }
}

describe("injection-notifier", () => {
  test("(a) same hash twice in same session → showToast called exactly 1×", async () => {
    //#given a fresh notifier and a TUI client
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true })
    const input = { sessionID: "ses-a", injector: "context-mode-routing", hash: "abc123", title: "Notice", message: "Context updated" }
    //#when the same injection is notified twice
    await notifyInjection(ctx, input)
    await notifyInjection(ctx, input)
    //#then dedupe: only one toast sent
    expect(seen.length).toBe(1)
  })

  test("(b) changed hash → 2nd toast fires", async () => {
    //#given a notified hash
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true })
    await notifyInjection(ctx, { sessionID: "ses-b", injector: "rtk-routing", hash: "h1", title: "Notice", message: "RTK rules applied" })
    //#when content hash changes
    await notifyInjection(ctx, { sessionID: "ses-b", injector: "rtk-routing", hash: "h2", title: "Notice", message: "RTK rules applied" })
    //#then second transition toasts again
    expect(seen.length).toBe(2)
  })

  test("(b2) same hash in different sessions → toasts independently", async () => {
    //#given per-session dedupe state
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true })
    //#when the same injector+hash fires in two sessions
    await notifyInjection(ctx, { sessionID: "ses-1", injector: "env-context-injector", hash: "same", title: "Notice", message: "Env context applied" })
    await notifyInjection(ctx, { sessionID: "ses-2", injector: "env-context-injector", hash: "same", title: "Notice", message: "Env context applied" })
    //#then each session gets its own first toast
    expect(seen.length).toBe(2)
  })

  test("(c) undefined client.tui → resolves, no throw, 0 calls", async () => {
    //#given a headless client with no TUI
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: false })
    //#when notifying headless
    await expect(
      notifyInjection(ctx, { sessionID: "ses-c", injector: "knowledge-hub-injector", hash: "h", title: "Notice", message: "Knowledge applied" })
    ).resolves.toBeUndefined()
    //#then fail-open: nothing sent, nothing thrown
    expect(seen.length).toBe(0)
  })

  test("(c2) rejecting showToast is swallowed fail-open", async () => {
    //#given a TUI whose toast rejects
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true, reject: true })
    //#when notifying
    await expect(
      notifyInjection(ctx, { sessionID: "ses-c2", injector: "post-read-injector", hash: "h", title: "Notice", message: "Post-read applied" })
    ).resolves.toBeUndefined()
    //#then rejection swallowed, nothing recorded
    expect(seen.length).toBe(0)
  })

  test("(d) notice text passes sanitizeKnownTags + keyword detector → 0 detections", async () => {
    //#given a notified toast payload
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true })
    await notifyInjection(ctx, { sessionID: "ses-d", injector: "category-skill-reminder", hash: "h", title: "Skill applied", message: "Category guidance updated" })
    //#when the notice body goes through the keyword-detector pipeline
    expect(seen.length).toBe(1)
    const body = seen[0].body.message
    const clean = sanitizeKnownTags(body, { presentation: "drop" })
    const detections = detectKeywordsWithType(clean)
    //#then loop-safe: zero keyword detections
    expect(detections.length).toBe(0)
  })

  test("(e) notice body ≤120 chars", async () => {
    //#given an over-long message
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx({ withTui: true })
    //#when notifying with a long body
    await notifyInjection(ctx, { sessionID: "ses-e", injector: "domain-keyword-detector", hash: "h", title: "Notice", message: "x".repeat(500) })
    //#then body is truncated to the 120-char budget
    expect(seen.length).toBe(1)
    expect(seen[0].body.message.length).toBeLessThanOrEqual(120)
  })
})
