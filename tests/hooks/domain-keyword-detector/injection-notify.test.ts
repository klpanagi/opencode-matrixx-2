import { describe, expect, test } from "bun:test"
import { createDomainKeywordDetectorHook } from "../../../src/hooks/domain-keyword-detector"
import { detectDomainSkills } from "../../../src/hooks/domain-keyword-detector/detector"
import { detectKeywordsWithType } from "../../../src/hooks/keyword-detector/detector"
import { resetInjectionNotifier } from "../../../src/shared/injection-notifier"
import { sanitizeKnownTags } from "../../../src/shared/system-directive"

//#given a mock ctx with a TUI showToast spy (mirrors tests/shared/injection-notifier.test.ts)
type ToastOpts = {
  body: { title: string; message: string; variant: "info"; duration: number }
}
function makeCtx() {
  const seen: ToastOpts[] = []
  const client = {
    tui: {
      showToast: async (o: ToastOpts) => {
        seen.push(o)
        return {}
      },
    },
  }
  return { ctx: { client } as never, seen }
}

type Hook = ReturnType<typeof createDomainKeywordDetectorHook>
type Output = Parameters<Hook["experimental.chat.messages.transform"]>[1]

function outputWith(text: string, sessionID: string): Output {
  return {
    messages: [{ info: { role: "user", sessionID }, parts: [{ type: "text", text }] }],
  } as unknown as Output
}

function textOf(output: Output): string {
  const msg = output.messages[0] as unknown as { parts: Array<{ text?: string }> }
  return msg?.parts[0]?.text ?? ""
}

describe("domain-keyword-detector injection notice", () => {
  test("first injection toasts once; marker-present second pass toasts 0x", async () => {
    //#given a fresh notifier and a TUI client
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createDomainKeywordDetectorHook(ctx)
    const output = outputWith("fetch OHLCV candles with ccxt", "ses-dom-1")

    //#when the detector injects, then the same output passes through again
    await hook["experimental.chat.messages.transform"]({}, output)
    //#then mutation happened and exactly one toast fired
    expect(textOf(output)).toContain("[domain-skills]")
    expect(seen.length).toBe(1)
    //#when the marker-present output passes through again (idempotent early-return)
    await hook["experimental.chat.messages.transform"]({}, output)
    //#then no new toast: still exactly one
    expect(seen.length).toBe(1)
  })

  test("changed skills injection toasts again", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createDomainKeywordDetectorHook(ctx)
    await hook["experimental.chat.messages.transform"]({}, outputWith("fetch OHLCV with ccxt", "ses-dom-2"))
    expect(seen.length).toBe(1)

    //#when a different skill set is injected in the same session
    await hook["experimental.chat.messages.transform"]({}, outputWith("ping my telegram bot", "ses-dom-2"))

    //#then the changed injection toasts again
    expect(seen.length).toBe(2)
  })

  test("no-keyword early-return never toasts", async () => {
    //#given a message with no domain keywords
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createDomainKeywordDetectorHook(ctx)

    //#when the hook early-returns without mutation
    const output = outputWith("just a normal message about nothing", "ses-dom-3")
    await hook["experimental.chat.messages.transform"]({}, output)

    //#then no toast fired
    expect(textOf(output)).toBe("just a normal message about nothing")
    expect(seen.length).toBe(0)
  })

  test("notice is loop-safe: triggers neither keyword-detector nor domain-detector", async () => {
    //#given a first injection toast
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createDomainKeywordDetectorHook(ctx)
    await hook["experimental.chat.messages.transform"]({}, outputWith("use grafana for dashboards", "ses-dom-4"))
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
