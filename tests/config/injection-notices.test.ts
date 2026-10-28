import { describe, expect, test } from "bun:test"
import { MatrixxConfigSchema } from "../../src/config/schema/matrixx-config"
import {
  INJECTION_NOTICE_MAX_BODY_LENGTH,
  notifyInjection,
  resetInjectionNotifier,
} from "../../src/shared/injection-notifier"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../src/shared/system-directive"

//#given a mock ctx with TUI toast spy + session.prompt spy (headless harness shape)
type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
}
type PromptArgs = { parts: Array<{ type: string; text?: string }>; noReply?: boolean }
function makeCtx() {
  const toasts: ToastOpts[] = []
  const prompts: PromptArgs[] = []
  const ctx = {
    client: {
      tui: {
        showToast: async (o: ToastOpts) => {
          toasts.push(o)
          return {}
        },
      },
      session: {
        prompt: async (args: PromptArgs) => {
          prompts.push(args)
          return { messageID: `msg-${prompts.length}` }
        },
      },
    },
  } as never
  return { ctx, toasts, prompts }
}

function persistentFromConfig(config: MiniConfig): boolean {
  return config.notification?.injection_notices?.persistent ?? false
}

describe("injection-notices config flag", () => {
  test("(a) default config → flag falsy, NO session.prompt call", async () => {
    //#given the default (empty) matrixx config
    const config = MatrixxConfigSchema.parse({})
    //#when deriving the persistent flag
    const persistent = persistentFromConfig(config)
    //#then flag is falsy (default OFF)
    expect(persistent).toBeFalsy()
    //#when notifying with the derived default flag
    resetInjectionNotifier()
    const { ctx, toasts, prompts } = makeCtx()
    await notifyInjection(ctx, {
      sessionID: "ses-flag-a",
      injector: "context-mode-routing",
      hash: "h1",
      title: "Notice",
      message: "Context updated",
      persistent,
    })
    //#then toast fires once, session.prompt never called
    expect(toasts.length).toBe(1)
    expect(prompts.length).toBe(0)
  })

  test("(b) flag ON → session.prompt once per dedupe transition + toast fires", async () => {
    //#given an opt-in config with persistent notices enabled
    const config = MatrixxConfigSchema.parse({ notification: { injection_notices: { persistent: true } } })
    expect(persistentFromConfig(config)).toBe(true)
    //#when the same injection is notified twice (dedupe transition then duplicate)
    resetInjectionNotifier()
    const { ctx, toasts, prompts } = makeCtx()
    const input = {
      sessionID: "ses-flag-b",
      injector: "rtk-routing",
      hash: "h1",
      title: "Notice",
      message: "RTK rules applied",
      persistent: true,
    }
    await notifyInjection(ctx, input)
    await notifyInjection(ctx, input)
    //#then exactly one persistent prompt per transition + toast also fired once
    expect(prompts.length).toBe(1)
    expect(toasts.length).toBe(1)
    //#and the prompt body carries the system-directive prefix within the 120-char budget
    const text = prompts[0].parts[0]?.text ?? ""
    expect(text.startsWith(SYSTEM_DIRECTIVE_PREFIX)).toBe(true)
    expect(text.length).toBeLessThanOrEqual(INJECTION_NOTICE_MAX_BODY_LENGTH)
    expect(prompts[0].noReply).toBe(true)
  })

  test("(c) explicit empty injection_notices → persistent defaults to false", () => {
    //#given configs that omit the persistent flag
    const bare = MatrixxConfigSchema.parse({ notification: {} })
    const emptyNested = MatrixxConfigSchema.parse({ notification: { injection_notices: {} } })
    //#then both derive falsy (default OFF — never model-visible unless opted in)
    expect(persistentFromConfig(bare)).toBeFalsy()
    expect(persistentFromConfig(emptyNested)).toBe(false)
  })

  test("(d) flag ON with over-long message → prompt body still ≤120 chars", async () => {
    //#given persistent enabled and an over-long message
    resetInjectionNotifier()
    const { ctx, prompts } = makeCtx()
    await notifyInjection(ctx, {
      sessionID: "ses-flag-d",
      injector: "domain-keyword-detector",
      hash: "h-long",
      title: "Notice",
      message: "x".repeat(500),
      persistent: true,
    })
    //#then the persistent body respects the same budget as the toast
    expect(prompts.length).toBe(1)
    expect((prompts[0].parts[0]?.text ?? "").length).toBeLessThanOrEqual(INJECTION_NOTICE_MAX_BODY_LENGTH)
  })
})
