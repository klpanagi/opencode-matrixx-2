import { afterEach, describe, expect, test, setSystemTime } from "bun:test"
import { createEnvContextInjectorHook } from "../../../src/hooks/env-context-injector/index"
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

type TestPart = {
  type: "text"
  text: string
  id: string
  messageID: string
  sessionID: string
}
type TestMessage = { info: { role: string; id: string; sessionID: string }; parts: TestPart[] }
type TestOutput = { messages: TestMessage[] }

function createMessage(role: string, text: string, sessionID: string, id = "msg_1"): TestMessage {
  return {
    info: { role, id, sessionID },
    parts: [{ type: "text", text, id: `part_${id}`, messageID: id, sessionID }],
  }
}

afterEach(() => {
  setSystemTime()
})

describe("env-context-injector injection notice", () => {
  test("first injection toasts once; same-content second call toasts 0x", async () => {
    //#given frozen time and a fresh notifier
    setSystemTime(new Date("2025-01-01T00:00:00Z"))
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createEnvContextInjectorHook(ctx)
    const transform = hook["experimental.chat.messages.transform"]
    if (!transform) throw new Error("transform missing")

    //#when the first message is injected
    const output1: TestOutput = { messages: [createMessage("user", "hello", "ses-env-1")] }
    await transform({}, output1 as never)
    //#then env block appended and exactly one toast fired
    expect(output1.messages[0].parts[0].text).toContain("<matrixx-env>")
    expect(seen.length).toBe(1)

    //#when a second message is injected under identical (frozen) env content
    const output2: TestOutput = { messages: [createMessage("user", "world", "ses-env-1")] }
    await transform({}, output2 as never)
    //#then dedupe suppresses the repeat: still exactly one toast
    expect(output2.messages[0].parts[0].text).toContain("<matrixx-env>")
    expect(seen.length).toBe(1)
  })

  test("changed env content toasts again", async () => {
    //#given a notified session at frozen time
    setSystemTime(new Date("2025-01-01T00:00:00Z"))
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createEnvContextInjectorHook(ctx)
    const transform = hook["experimental.chat.messages.transform"]
    if (!transform) throw new Error("transform missing")
    await transform({}, { messages: [createMessage("user", "hello", "ses-env-2")] } as never)
    expect(seen.length).toBe(1)

    //#when time advances so the injected env block changes
    setSystemTime(new Date("2025-06-15T14:30:00Z"))
    await transform({}, { messages: [createMessage("user", "world", "ses-env-2")] } as never)

    //#then the changed injection toasts again
    expect(seen.length).toBe(2)
  })

  test("no-user-message early-return never toasts", async () => {
    //#given output with no user message
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createEnvContextInjectorHook(ctx)
    const transform = hook["experimental.chat.messages.transform"]
    if (!transform) throw new Error("transform missing")

    //#when the hook early-returns without mutation
    await transform({}, { messages: [createMessage("assistant", "hi", "ses-env-3")] } as never)

    //#then no toast fired
    expect(seen.length).toBe(0)
  })

  test("notice is loop-safe: triggers neither keyword-detector nor domain-detector", async () => {
    //#given a first injection toast
    setSystemTime(new Date("2025-01-01T00:00:00Z"))
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createEnvContextInjectorHook(ctx)
    const transform = hook["experimental.chat.messages.transform"]
    if (!transform) throw new Error("transform missing")
    await transform({}, { messages: [createMessage("user", "hello", "ses-env-4")] } as never)
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
