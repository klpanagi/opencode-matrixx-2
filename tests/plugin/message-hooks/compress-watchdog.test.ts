/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test"

import {
  _resetForTesting as resetSessionState,
  registerSubagentSession,
} from "../../../src/features/session-state/state"
import {
  findLastUserMessage,
  registerCompressWatchdog,
} from "../../../src/plugin/message-hooks/compress-watchdog"
import type { MatrixxContext, V2SessionContextEvent } from "../../../src/plugin/tool/context"
import { COMPRESS_WATCHDOG_MARKER } from "../../../src/shared/policy/compress-watchdog"

type Handler = (event: V2SessionContextEvent) => Promise<void>

const MODEL_LIST = [
  {
    providerID: "commandcode",
    id: "deepseek/deepseek-v4.1-flash",
    limit: { context: 1_000_000 },
  },
]

function usageMessages(input: number, output = 1_000): unknown[] {
  return [
    { type: "user", text: "please continue" },
    {
      type: "assistant",
      model: { providerID: "commandcode", modelID: "deepseek/deepseek-v4.1-flash" },
      tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  ]
}

function makeEvent(messages: unknown[], tools: Record<string, unknown> = { compress: {} }) {
  return {
    sessionID: "ses_main",
    agent: "morpheus",
    model: {},
    system: [],
    messages,
    options: {},
    tools,
  } as unknown as V2SessionContextEvent
}

async function setup(options: {
  models?: unknown
  config?: Parameters<typeof registerCompressWatchdog>[1]["config"]
  hookEnabled?: boolean
}) {
  let handler: Handler | null = null
  const ctx = {
    session: {
      hook: async (_name: string, cb: Handler) => {
        handler = cb
        return { dispose: async () => {} }
      },
      context: async () => [],
    },
    model: { list: async () => options.models ?? MODEL_LIST },
  } as unknown as MatrixxContext
  const registrations = await registerCompressWatchdog(ctx, {
    config: options.config ?? { enabled: true, abovePercent: 25, targetPercent: 10, cooldownTurns: 2 },
    ...(options.hookEnabled !== undefined ? { hookEnabled: options.hookEnabled } : {}),
  })
  return {
    registrations,
    fire: async (event: V2SessionContextEvent) => {
      if (!handler) throw new Error("handler not registered")
      await handler(event)
    },
  }
}

function textOf(messages: unknown[], index: number): string {
  return ((messages[index] as { text?: string }).text ?? "") as string
}

beforeEach(() => {
  resetSessionState()
})

describe("registerCompressWatchdog", () => {
  test("registers nothing when disabled or the hook name is disabled", async () => {
    //#given / #when
    const disabled = await setup({ config: { enabled: false } })
    const hookDisabled = await setup({ hookEnabled: false })

    //#then
    expect(disabled.registrations).toEqual([])
    expect(hookDisabled.registrations).toEqual([])
  })

  test("injects the directive into the last user message above the ceiling", async () => {
    //#given 30% usage
    const { fire } = await setup({})
    const messages = usageMessages(299_000)

    //#when
    await fire(makeEvent(messages))

    //#then
    const text = textOf(messages, 0)
    expect(text.startsWith(COMPRESS_WATCHDOG_MARKER)).toBe(true)
    expect(text).toContain("at or below 10%")
    expect(text).toContain("please continue")
    expect(messages[1]).not.toHaveProperty("text")
  })

  test("stays silent below the ceiling", async () => {
    //#given 20% usage
    const { fire } = await setup({})
    const messages = usageMessages(199_000)

    //#when
    await fire(makeEvent(messages))

    //#then
    expect(textOf(messages, 0)).toBe("please continue")
  })

  test("honors the cooldown between directives", async () => {
    //#given an armed session
    const { fire } = await setup({})

    //#when the same session is built three times
    const first = usageMessages(299_000)
    await fire(makeEvent(first))
    const second = usageMessages(299_000)
    await fire(makeEvent(second))
    const third = usageMessages(299_000)
    await fire(makeEvent(third))

    //#then only the first and third carry the directive
    expect(textOf(first, 0)).toContain(COMPRESS_WATCHDOG_MARKER)
    expect(textOf(second, 0)).toBe("please continue")
    expect(textOf(third, 0)).toContain(COMPRESS_WATCHDOG_MARKER)
  })

  test("never injects into a subagent session", async () => {
    //#given a registered subagent session
    registerSubagentSession("ses_main", "ses_parent")
    const { fire } = await setup({})
    const messages = usageMessages(299_000)

    //#when
    await fire(makeEvent(messages))

    //#then
    expect(textOf(messages, 0)).toBe("please continue")
  })

  test("never injects when the compress tool is absent", async () => {
    //#given a session without DCP's compress tool
    const { fire } = await setup({})
    const messages = usageMessages(299_000)

    //#when
    await fire(makeEvent(messages, {}))

    //#then
    expect(textOf(messages, 0)).toBe("please continue")
  })

  test("never injects twice into the same message", async () => {
    //#given a message that already carries the marker
    const { fire } = await setup({})
    const messages = usageMessages(299_000)
    ;(messages[0] as { text: string }).text = `${COMPRESS_WATCHDOG_MARKER}\nold`

    //#when
    await fire(makeEvent(messages))

    //#then
    expect(textOf(messages, 0)).toBe(`${COMPRESS_WATCHDOG_MARKER}\nold`)
  })

  test("fails open when the model window cannot be resolved", async () => {
    //#given a model list without the active model
    const { fire } = await setup({ models: [{ providerID: "other", id: "x", limit: { context: 128_000 } }] })
    const messages = usageMessages(299_000)

    //#when
    await fire(makeEvent(messages))

    //#then
    expect(textOf(messages, 0)).toBe("please continue")
  })
})

describe("findLastUserMessage", () => {
  test("returns the newest user message carrying text", () => {
    //#given
    const messages = [
      { type: "user", text: "first" },
      { type: "assistant", text: "answer" },
      { type: "user", text: "last" },
    ]

    //#when / #then
    expect(findLastUserMessage(messages)).toEqual({ index: 2, text: "last" })
    expect(findLastUserMessage([{ type: "assistant", text: "x" }])).toBeNull()
  })
})
