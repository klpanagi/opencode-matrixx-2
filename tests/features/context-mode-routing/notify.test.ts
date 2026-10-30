/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"

import type { MatrixxConfig } from "../../../src/config"
import { buildContextModeRoutingBlock } from "../../../src/features/context-mode-routing/routing-block"
import {
  CONTEXT_MODE_INJECTOR_ID,
  CONTEXT_MODE_NOTICE_MESSAGE,
  CONTEXT_MODE_NOTICE_TITLE,
  createContextModeSystemTransformHook,
  hashInjectionContent,
} from "../../../src/features/context-mode-routing/system-transform"
import { detectKeywordsWithType } from "../../../src/hooks/keyword-detector/detector"
import { notifyInjection, resetInjectionNotifier } from "../../../src/shared/injection-notifier"
import { sanitizeKnownTags } from "../../../src/shared/system-directive"

const BASE_CONFIG = {
  context_mode: { enabled: true },
} as unknown as MatrixxConfig

function model() {
  return { providerID: "anthropic", modelID: "claude-opus-4-6" } as never
}

type ToastOpts = {
  body: { title: string; message: string; variant: "info" | "success"; duration: number }
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
  return { ctx: { client } as unknown as MatrixxContext, seen }
}

describe("context-mode-routing injection notice", () => {
  test("fresh inject → exactly 1 toast", async () => {
    //#given a fresh notifier and a TUI client
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createContextModeSystemTransformHook(BASE_CONFIG, ctx)
    //#when the routing block is spliced into a fresh system prompt
    await hook({ sessionID: "ses_ctx_notify_1", model: model() }, { system: ["sys-a"] })
    //#then exactly one toast fires
    expect(seen.length).toBe(1)
    expect(seen[0].body.title).toBe(CONTEXT_MODE_NOTICE_TITLE)
  })

  test("marker-present early-return → 0 new toasts", async () => {
    //#given a session that already received the routing-block toast
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createContextModeSystemTransformHook(BASE_CONFIG, ctx)
    await hook({ sessionID: "ses_ctx_notify_2", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    //#when the transform runs again with the marker already present
    await hook(
      { sessionID: "ses_ctx_notify_2", model: model() },
      { system: ["sys-a", `prior ${buildContextModeRoutingBlock().slice(0, 32)} block`] },
    )
    //#then idempotent early-return: no new toast
    expect(seen.length).toBe(1)
  })

  test("changed content → exactly 1 new toast", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createContextModeSystemTransformHook(BASE_CONFIG, ctx)
    await hook({ sessionID: "ses_ctx_notify_3", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    expect(hashInjectionContent("block-v1")).not.toBe(hashInjectionContent("block-v2"))
    //#when the injected content changes (new block version → new hash)
    await notifyInjection(ctx, {
      sessionID: "ses_ctx_notify_3",
      injector: CONTEXT_MODE_INJECTOR_ID,
      hash: hashInjectionContent(`${buildContextModeRoutingBlock()}#v2`),
      title: CONTEXT_MODE_NOTICE_TITLE,
      message: CONTEXT_MODE_NOTICE_MESSAGE,
    })
    //#then exactly one new toast fires
    expect(seen.length).toBe(2)
  })

  test("notice body is loop-safe through the keyword-detector pipeline", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createContextModeSystemTransformHook(BASE_CONFIG, ctx)
    await hook({ sessionID: "ses_ctx_notify_4", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    //#when the real notice body goes through the keyword-detector pipeline
    const clean = sanitizeKnownTags(seen[0].body.message, { presentation: "drop" })
    const detections = detectKeywordsWithType(clean)
    //#then loop-safe: zero keyword detections
    expect(detections.length).toBe(0)
  })
})
