/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { MatrixxContext } from "../../../src/plugin/context"

import type { MatrixxConfig } from "../../../src/config"
import { detectKeywordsWithType } from "../../../src/hooks/keyword-detector/detector"
import { buildRtkRoutingBlock } from "../../../src/features/rtk-routing/routing-block"
import {
  createRtkSystemTransformHook,
  hashRtkInjectionContent,
  RTK_INJECTOR_ID,
  RTK_NOTICE_MESSAGE,
  RTK_NOTICE_TITLE,
} from "../../../src/features/rtk-routing/system-transform"
import { notifyInjection, resetInjectionNotifier } from "../../../src/shared/injection-notifier"
import { sanitizeKnownTags } from "../../../src/shared/system-directive"

function model() {
  return { providerID: "anthropic", modelID: "claude-opus-4-6" } as never
}

function rtkConfig(): MatrixxConfig {
  return { rtk: { enabled: true, timeout_ms: 5000 } } as unknown as MatrixxConfig
}

function activeOpts() {
  return { which: () => "/usr/bin/rtk", hasBash: () => true }
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

describe("rtk-routing injection notice", () => {
  test("fresh inject → exactly 1 toast", async () => {
    //#given a fresh notifier and a TUI client
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createRtkSystemTransformHook(rtkConfig(), activeOpts(), ctx)
    //#when the routing block is spliced into a fresh system prompt
    await hook({ sessionID: "ses_rtk_notify_1", model: model() }, { system: ["sys-a"] })
    //#then exactly one toast fires
    expect(seen.length).toBe(1)
    expect(seen[0].body.title).toBe(RTK_NOTICE_TITLE)
  })

  test("marker-present early-return → 0 new toasts", async () => {
    //#given a session that already received the routing-block toast
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createRtkSystemTransformHook(rtkConfig(), activeOpts(), ctx)
    await hook({ sessionID: "ses_rtk_notify_2", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    //#when the transform runs again with the marker already present
    await hook(
      { sessionID: "ses_rtk_notify_2", model: model() },
      { system: ["sys-a", `prior ${buildRtkRoutingBlock().slice(0, 24)} block`] },
    )
    //#then idempotent early-return: no new toast
    expect(seen.length).toBe(1)
  })

  test("changed content → exactly 1 new toast", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createRtkSystemTransformHook(rtkConfig(), activeOpts(), ctx)
    await hook({ sessionID: "ses_rtk_notify_3", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    expect(hashRtkInjectionContent("block-v1")).not.toBe(hashRtkInjectionContent("block-v2"))
    //#when the injected content changes (new block version → new hash)
    await notifyInjection(ctx, {
      sessionID: "ses_rtk_notify_3",
      injector: RTK_INJECTOR_ID,
      hash: hashRtkInjectionContent(`${buildRtkRoutingBlock()}#v2`),
      title: RTK_NOTICE_TITLE,
      message: RTK_NOTICE_MESSAGE,
    })
    //#then exactly one new toast fires
    expect(seen.length).toBe(2)
  })

  test("notice body is loop-safe through the keyword-detector pipeline", async () => {
    //#given a notified session
    resetInjectionNotifier()
    const { ctx, seen } = makeCtx()
    const hook = createRtkSystemTransformHook(rtkConfig(), activeOpts(), ctx)
    await hook({ sessionID: "ses_rtk_notify_4", model: model() }, { system: ["sys-a"] })
    expect(seen.length).toBe(1)
    //#when the real notice body goes through the keyword-detector pipeline
    const clean = sanitizeKnownTags(seen[0].body.message, { presentation: "drop" })
    const detections = detectKeywordsWithType(clean)
    //#then loop-safe: zero keyword detections
    expect(detections.length).toBe(0)
  })
})
