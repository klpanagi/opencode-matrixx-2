/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { buildBuiltinMcpEntries } from "../../src/mcps/mcp.transform"

describe("buildBuiltinMcpEntries — lazy CONTEXT7_API_KEY (Phase A)", () => {
  test("key-set → Authorization Bearer header, oauth false", async () => {
    //#given
    const input = { uvxAvailable: true, context7ApiKey: "key-123" }

    //#when
    const { entries } = buildBuiltinMcpEntries(input as never)

    //#then
    const ctx7 = entries.context7 as { headers?: Record<string, string>; oauth?: false; enabled: boolean }
    expect(ctx7).toBeDefined()
    expect(ctx7.enabled).toBe(true)
    expect(ctx7.headers).toEqual({ Authorization: "Bearer key-123" })
    expect(ctx7.oauth).toBe(false)
  })

  test("key-absent → headers undefined, entry still present/enabled", async () => {
    //#given
    const input = { uvxAvailable: true }

    //#when
    const { entries } = buildBuiltinMcpEntries(input)

    //#then
    const ctx7 = entries.context7 as { headers?: Record<string, string>; enabled: boolean; oauth?: false }
    expect(ctx7).toBeDefined()
    expect(ctx7.enabled).toBe(true)
    expect(ctx7.headers).toBeUndefined()
    expect(ctx7.oauth).toBe(false)
  })

  test("empty key → headers undefined", async () => {
    //#given
    const input = { uvxAvailable: true, context7ApiKey: "" }

    //#when
    const { entries } = buildBuiltinMcpEntries(input)

    //#then
    const ctx7 = entries.context7 as { headers?: Record<string, string> }
    expect(ctx7.headers).toBeUndefined()
  })

  test("rotation between calls reflected without re-import", async () => {
    //#given
    const first = buildBuiltinMcpEntries({ uvxAvailable: true, context7ApiKey: "a" } as never)
    //#when
    const second = buildBuiltinMcpEntries({ uvxAvailable: true, context7ApiKey: "b" } as never)
    //#then
    expect((first.entries.context7 as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer a",
    })
    expect((second.entries.context7 as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer b",
    })
  })

  test("disabled_mcps context7 still omits entry even with key", async () => {
    //#given
    const input = { uvxAvailable: true, context7ApiKey: "k", disabledMcps: ["context7"] }

    //#when
    const { entries } = buildBuiltinMcpEntries(input as never)

    //#then
    expect(entries).not.toHaveProperty("context7")
  })
})
