import { describe, expect, test } from "bun:test"
import { normalizeSDKResponse } from "../../src/shared/normalize-sdk-response"
import {
  getCachedSdkMessages,
  invalidateSdkMessageCache,
  setCachedSdkMessages,
} from "../../src/features/hook-message-injector/sdk-message-cache"
import { createClientShim } from "../../src/plugin/opencode-client"
import type { V2Context } from "../../src/plugin/opencode-types"

type MessagesFn = (args?: { path?: { id: string } }) => Promise<{ data: unknown }>
type ContextFn = (args?: { path?: { id: string } }) => Promise<{ data: unknown }>

function makeShim(contextResult: unknown): { messages: MessagesFn; context: ContextFn } {
  const fakeCtx = {
    session: {
      context: async () => contextResult,
    },
  }
  const shim = createClientShim(fakeCtx as unknown as V2Context) as unknown as {
    session: { messages: MessagesFn; context: ContextFn }
  }
  return { messages: shim.session.messages, context: shim.session.context }
}

describe("opencode-client session.messages contract", () => {
  test("returns the message array, not the context wrapper", async () => {
    //#given
    const m1 = { info: { role: "user" } }
    const m2 = { info: { role: "assistant" } }
    const { messages } = makeShim({ messages: [m1, m2] })
    //#when
    const result = await messages({ path: { id: "s1" } })
    //#then
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.data).toEqual([m1, m2])
  })

  test("normalizes to a usable array (consumer contract)", async () => {
    //#given
    const m1 = { info: { role: "user" } }
    const m2 = { info: { role: "assistant" } }
    const { messages } = makeShim({ messages: [m1, m2] })
    //#when
    const result = await messages({ path: { id: "s1" } })
    const normalized = normalizeSDKResponse(result, [])
    //#then
    expect(normalized).toHaveLength(2)
    expect(normalized[0]).toEqual(m1)
  })

  test("passes a bare array through unchanged", async () => {
    //#given
    const m1 = { info: { role: "user" } }
    const { messages } = makeShim([m1])
    //#when
    const result = await messages({ path: { id: "s1" } })
    //#then
    expect(result.data).toEqual([m1])
  })

  test("degrades to an empty array, never the wrapper", async () => {
    //#given
    const emptyShim = makeShim({})
    const garbageShim = makeShim({ messages: "nope" })
    //#when
    const emptyResult = await emptyShim.messages({ path: { id: "s1" } })
    const garbageResult = await garbageShim.messages({ path: { id: "s1" } })
    //#then
    expect(emptyResult.data).toEqual([])
    expect(garbageResult.data).toEqual([])
    expect(normalizeSDKResponse(emptyResult, [])).toHaveLength(0)
  })

  test("does not populate the SDK message cache", async () => {
    //#given
    const id = `ses-cache-${crypto.randomUUID()}`
    const { messages } = makeShim({ messages: [{ info: { role: "user" } }] })
    //#when
    await messages({ path: { id } })
    //#then
    expect(getCachedSdkMessages(id)).toBeUndefined()
  })

  test("the value handed to the cache is array-typed (poisoning guard)", async () => {
    //#given
    const id = `ses-cache-${crypto.randomUUID()}`
    const m1 = { info: { role: "user" } }
    const m2 = { info: { role: "assistant" } }
    const { messages } = makeShim({ messages: [m1, m2] })
    //#when
    const result = await messages({ path: { id } })
    const value = normalizeSDKResponse(result, [], { preferResponseOnMissingData: true })
    //#then
    expect(Array.isArray(value)).toBe(true)
    setCachedSdkMessages(id, value as unknown[])
    expect(getCachedSdkMessages(id)).toHaveLength(2)
    invalidateSdkMessageCache(id)
  })

  test("context member still returns the raw object", async () => {
    //#given
    const payload = { messages: [{ info: { role: "user" } }] }
    const { context } = makeShim(payload)
    //#when
    const result = await context({ path: { id: "s1" } })
    //#then
    expect(result.data).toEqual(payload)
  })
})
